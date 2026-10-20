import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { debugSession } from './logging.js';
import { sessionOpened, sessionClosed } from './metrics.js';

interface Session {
  transport: Transport;
  lastActivity: number;
  /** Rate-limit identity of the client that opened the session (per-client quota). */
  clientKey: string;
}

/**
 * Manages transport sessions with automatic cleanup
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly maxSessions: number,
    private readonly sessionTimeoutMs: number
  ) {
    debugSession(
      'SessionManager created with max sessions: %d, timeout: %dms',
      maxSessions,
      sessionTimeoutMs
    );
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Run cleanup every minute
    debugSession('Cleanup interval started (60s)');
  }

  /**
   * Add a new session
   * @throws {Error} If max sessions limit is reached
   */
  add(sessionId: string, transport: Transport, clientKey = ''): void {
    debugSession('Adding session: %s (current count: %d)', sessionId, this.sessions.size);

    if (this.sessions.size >= this.maxSessions && !this.sessions.has(sessionId)) {
      debugSession('Max sessions limit reached (%d), rejecting new session', this.maxSessions);
      throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`);
    }

    this.sessions.set(sessionId, {
      transport,
      lastActivity: Date.now(),
      clientKey,
    });

    sessionOpened();
    debugSession('Session added successfully: %s (new count: %d)', sessionId, this.sessions.size);
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): Transport | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      const previousActivity = session.lastActivity;
      session.lastActivity = Date.now();
      debugSession(
        'Session accessed: %s, activity updated from %d to %d',
        sessionId,
        previousActivity,
        session.lastActivity
      );
      return session.transport;
    }
    debugSession('Session not found: %s', sessionId);
    return undefined;
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): void {
    debugSession('Removing session: %s', sessionId);
    const session = this.sessions.get(sessionId);
    if (session) {
      // Delete from map first to prevent recursion: close() triggers onclose → remove()
      this.sessions.delete(sessionId);
      sessionClosed();
      debugSession('Session removed: %s (remaining: %d)', sessionId, this.sessions.size);
      // Close the transport if it has a close method
      if ('close' in session.transport && typeof session.transport.close === 'function') {
        debugSession('Closing transport for session: %s', sessionId);
        session.transport.close();
      }
    } else {
      debugSession('Session not found for removal: %s', sessionId);
    }
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    debugSession('Running cleanup, checking %d sessions', this.sessions.size);

    for (const [sessionId, session] of this.sessions) {
      const idleTime = now - session.lastActivity;
      if (idleTime > this.sessionTimeoutMs) {
        debugSession('Session %s expired (idle: %dms)', sessionId, idleTime);
        expired.push(sessionId);
      }
    }

    debugSession('Found %d expired sessions', expired.length);
    for (const sessionId of expired) {
      console.error(`Session ${sessionId} expired, removing...`);
      this.remove(sessionId);
    }

    if (expired.length === 0) {
      debugSession('No expired sessions found');
    }
  }

  /**
   * Stop the session manager and clean up all sessions
   */
  stop(): void {
    debugSession('Stopping SessionManager, closing %d sessions', this.sessions.size);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      debugSession('Cleanup interval stopped');
    }

    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      this.remove(sessionId);
    }

    debugSession('SessionManager stopped, all sessions closed');
  }

  /**
   * Count the open sessions of one client (by the key given to {@link add}).
   */
  countForClient(clientKey: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.clientKey === clientKey) count++;
    }
    return count;
  }

  /**
   * Get current session count
   */
  get size(): number {
    return this.sessions.size;
  }
}
