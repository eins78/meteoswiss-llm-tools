// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { SITE, BASE } from './site.config.mjs';

// https://astro.build/config
export default defineConfig({
	site: SITE,
	base: BASE,
	integrations: [
		starlight({
			title: 'MeteoSwiss LLM Tools',
			// Matches the default Starlight resolves anyway (public/favicon.svg) — set explicitly
			// so the weather-emoji favicon is documented, not just an accident of file placement.
			favicon: '/favicon.svg',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/eins78/meteoswiss-llm-tools' },
			],
			// Public docs for three audiences (user / operator / development) plus the evidence behind the
			// design (evaluations). Plans, sessionlogs, research and test reports are deliberately NOT
			// published. user/, operator/, development/ are hand-authored; evaluations/ mixes a hand-authored
			// index with files assembled by scripts/sync-content.ts (runs/ and evaluations/skill-vs-mcp.md).
			sidebar: [
				{ label: 'Use it', items: [
					'user/getting-started', 'user/tools', 'user/agent-skill', 'user/data-and-limits',
				] },
				{ label: 'Run it', items: [
					'operator/install', 'operator/configuration', 'operator/monitoring', 'operator/releases',
				] },
				{ label: 'Build on it', items: [
					'development/architecture', 'development/testing', 'development/releasing', 'development/contributing',
				] },
				{ label: 'Evaluations', items: [
					'evaluations', 'evaluations/skill-vs-mcp', { label: 'Eval runs', items: [{ autogenerate: { directory: 'runs' } }] },
				] },
			],
		}),
	],
});
