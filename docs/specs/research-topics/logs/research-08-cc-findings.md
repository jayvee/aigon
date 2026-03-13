---
status: submitted
updated: 2026-03-13T04:12:05.380Z
---

# Research Findings: aigon demo video style

**Agent:** Claude (cc)
**Research ID:** 08
**Date:** 2026-03-13

---

## Key Findings

### 1. Hand-Drawn / Whiteboard Animation Tools

| Tool | Price | Scripted/Declarative? | Whiteboard Quality | API? | Effort (2-min, beginner) |
|------|-------|-----------------------|--------------------|------|--------------------------|
| **VideoScribe** | $15/mo (annual) | No (GUI timeline) | Excellent — gold standard | No | 4-8 hrs |
| **Doodly** | $20/mo (annual) | No (manual drag-drop) | Good — purpose-built | No | 6-10 hrs |
| **Animaker** | Free–$49/mo | Partial (Ultragen API, JSON) | Good — whiteboard mode + AI generation | Yes | 2-4 hrs (AI mode) |
| **RenderForest** | $9–49/mo | **Yes — Node.js SDK, REST API** | Good — 450+ pre-animated scenes | **Best in class** | 2-4 hrs (UI), 6-10 hrs (API first time) |
| **CreateStudio** | $67 lifetime | No | Moderate — whiteboard is secondary | No | 8-12 hrs |
| **Vyond** | $99–199/mo | Partial (Vyond Go AI) | Limited — corporate focus | Zapier only | 2-4 hrs (AI), 8-15 hrs (manual) |
| **Powtoon** | $49–125/mo | Partial (enterprise API) | Moderate | Enterprise | 4-8 hrs |

**Winner for automation:** RenderForest — only tool with a proper developer SDK for composing scenes programmatically from templates.

**Winner for quality:** VideoScribe — best hand-drawn aesthetic, most beginner-friendly.

**Winner for speed:** Animaker AI whiteboard — generates whiteboard videos from text prompts.

### 2. Code-Driven Animation Frameworks

| Framework | Language | Hand-Drawn Aesthetic? | Scriptable/Repeatable? | Learning Curve | Time to 2-min video |
|-----------|----------|----------------------|----------------------|----------------|---------------------|
| **Remotion** | React/TS | Yes — via rough.js integration | Excellent — parameterized, declarative | Low-moderate (if React) | 1-2 weeks (first), 2-3 days (subsequent) |
| **Motion Canvas** | TypeScript | Possible — via rough.js | Excellent — live preview editor | Moderate | 1-3 weeks (first), 2-4 days (subsequent) |
| **Manim** | Python | Not native — clean vector style | Excellent | Moderate-steep | 2-4 weeks (first), 3-5 days (subsequent) |
| **handanim** | Python | **Yes — purpose-built for whiteboard** | Good | Low-moderate | 1-2 weeks |
| **Excalidraw + StoryMotion** | GUI | **Native whiteboard** | Limited (GUI tool) | Low | 3-6 hrs |
| **Excalidraw + ExcaliMotion** | GUI | **Native whiteboard** | Limited (GUI tool) | Low | 3-6 hrs |

**Top pick for developers:** Remotion + rough.js + Virgil font — hand-drawn aesthetic, fully scriptable, React-based, re-renderable when content changes.

**Fastest path:** StoryMotion — animate Excalidraw drawings with a timeline editor, export 4K/60fps. But not code-driven, so less repeatable.

**Hybrid approach:** Create diagrams in Excalidraw → export SVG → animate in Remotion/Motion Canvas. Best of both worlds.

Key libraries for hand-drawn rendering:
- **rough.js** (<9kB) — core library for sketchy rendering on Canvas/SVG
- **svg2roughjs** — converts clean SVGs to hand-drawn versions
- **rough-notation** — animated hand-drawn annotations (underlines, circles, brackets)

### 3. AI Video Generation / Virtual Presenters

| Tool | Price | Whiteboard Style? | Effort | Best For |
|------|-------|-------------------|--------|----------|
| **Synthesia** | $18–89/mo | No — talking-head only | Very low | Corporate presenters |
| **HeyGen** | $24–149/mo | Claimed but limited | Low | Realistic avatars, multilingual |
| **D-ID** | $6–196/mo | No — photo-to-video | Very low | Budget avatar videos |
| **Colossyan** | Free–$88/mo | No — avatar-driven | Low | Training/e-learning |
| **Sora 2** | $20–200/mo (ChatGPT) | Unpredictable | High (stitching) | Cinematic, not demos |
| **Runway Gen-4.5** | $12+/mo | Unpredictable | High | Creative/artistic |
| **Pika 2.5** | $8/mo | Style presets (promising) | Medium-high | Stylized content |

**Verdict:** None of the AI video generators reliably produce whiteboard/sketch-style content. They're built for talking-head avatars or generative video. Not the right fit for the hand-drawn explainer concept.

### 4. AI Voice Synthesis for Narration

| Tool | Price | Quality | Voice Cloning | API | Cost for 2 min |
|------|-------|---------|---------------|-----|----------------|
| **ElevenLabs** | Free–$99/mo | **Best overall** — v3 emotional expressiveness | Yes | Yes | Free tier covers it |
| **Murf.ai** | $29–99/mo | Excellent — "Say It My Way" tone guidance | Yes (guided) | Yes | Free trial covers it |
| **OpenAI TTS** | $12–30/1M chars | Very good — steerable via prompting | No | API-only | ~$0.05 |
| **Google Cloud TTS** | $4–16/1M chars | Excellent — high naturalness scores | Yes | Yes | Free tier covers it |
| **Play.ht** | $31+/mo (unlimited) | Good — reliability concerns | Yes | Yes | Covered by sub |
| **WellSaid Labs** | $44–199/mo | Professional — English only | No | Yes | Covered by sub |
| **Amazon Polly** | $5–19/1M chars | Decent — per-word timestamps useful | No | AWS SDK | Free tier (12 months) |
| **Bark** (open source) | Free (self-hosted) | Variable — creative but inconsistent | No | Self-host | $0 + compute |

**Top pick:** ElevenLabs — industry-leading quality, free tier covers a 2-min demo, API available.

**Budget pick:** OpenAI TTS — $0.05 for 2 minutes, good quality, API-only.

**Sync advantage:** Amazon Polly provides per-word timestamps, useful for syncing narration to animations.

### 5. Screen Recording Tools

| Tool | Price | Polish Level | Post-Production | Repeatability | Effort |
|------|-------|-------------|-----------------|---------------|--------|
| **Screen Studio** | $9/mo or $229 once | **Very high** — auto-zoom, cursor effects | Moderate | Moderate (re-record is fast) | Low |
| **FocuSee** | $60/yr or $200 once | High — similar to Screen Studio | Good — more built-in editing | Moderate | Low |
| **ScreenFlow** | $169 once | Professional | **Excellent** — full NLE | **Good** — splice segments | Moderate |
| **Camtasia** | $179–499/yr | Professional | Excellent — text-based editing | Good | Moderate |
| **OBS Studio** | Free | Raw only | None — needs external editor | Poor | High |
| **Loom** | Free–$20/mo | Basic | Minimal (trim only) | Poor — full re-record | Low |
| **Kap** | Free | Basic | Trim only | Poor | Moderate |
| **CleanShot X** | $29 once | Good for clips | Basic | Poor | Moderate |

**Best effort-to-polish ratio:** Screen Studio — record, auto-enhance, export. Purpose-built for developer demos.

**Best for updates:** ScreenFlow — multi-clip timeline lets you re-record one segment and splice it in without touching the rest.

### 6. Hybrid Approaches (Best of Both Worlds)

| Approach | Concept Portion | Demo Portion | Effort | Repeatability | Quality |
|----------|----------------|-------------|--------|---------------|---------|
| **Excalidraw diagrams + Screen Studio** | Hand-drawn diagrams recorded in Excalidraw | Auto-zoomed screen recording | 3-5 hrs | Good (diagrams editable) | High |
| **Keynote animations + Screen recording** | Animated slides with hand-drawn assets | Screen Studio / ScreenFlow | 3-5 hrs | **Excellent** (edit slides, re-export) | High |
| **Remotion + screen recording** | Code-driven rough.js animations | Embed screen captures in Remotion | 1-2 weeks first | **Excellent** (all code) | Very high |
| **Canva video editor** | Upload assets + AI voiceover | Upload screen clips | 2-3 hrs | Moderate | Decent |
| **Airtime (mmhmm)** | Live overlay of diagrams | Live screen recording | 2-3 hrs | Low (live recording) | Good |

### 7. Repeatability Ranking

When features change, how easy is it to update the video?

1. **Code-driven (Remotion/Manim)** — change code, re-render. Near-zero update cost.
2. **Keynote/PowerPoint** — edit slides, re-export. Version-controllable.
3. **ScreenFlow/Camtasia** — splice in re-recorded segments.
4. **RenderForest API** — update scene parameters, re-render via API.
5. **Screen Studio/FocuSee** — fast re-record, but full recording needed.
6. **GUI whiteboard tools** — manual re-editing of individual scenes.
7. **Loom/Kap/OBS** — full re-record from scratch.

### 8. Cost & Effort Summary

| Approach | Monthly Cost | First Video (hrs) | Update (hrs) | Repeatability |
|----------|-------------|-------------------|-------------|---------------|
| **VideoScribe + ElevenLabs** | $15 + $0 (free tier) | 6-10 | 3-5 | Low |
| **Animaker AI + ElevenLabs** | $19 + $0 | 2-4 | 1-2 | Medium |
| **RenderForest API + OpenAI TTS** | $38 + $0.05 | 8-12 (first), 0.5 (after) | 0.5 | High |
| **Remotion + rough.js + ElevenLabs** | $0 (OSS) + $0 | 10-20 (first), 2-3 (after) | 1-2 | Very high |
| **Excalidraw + Screen Studio + ElevenLabs** | $9 + $0 | 3-5 | 1-2 | Good |
| **Keynote + Screen Studio + ElevenLabs** | $9 + $0 | 3-5 | 1 | Excellent |
| **Screen Studio alone** | $9 | 1-2 | 1 | Moderate |

## Sources

### Whiteboard/Animation Tools
- [VideoScribe Pricing](https://www.videoscribe.co/pricing/)
- [Doodly Pricing](https://www.doodly.com/doodly-pricing)
- [Animaker Pricing](https://app.animaker.com/pricing) / [Ultragen API](https://app.animaker.com/ultragen-api)
- [RenderForest Plans](https://www.renderforest.com/subscription) / [API Docs](https://developers.renderforest.com/) / [Node.js SDK](https://github.com/renderforest/renderforest-sdk-node)
- [CreateStudio Review](https://guideblogging.com/createstudio-review/)
- [Vyond Plans](https://www.vyond.com/plans/) / [Vyond Go](https://www.vyond.com/product/vyond-go/)
- [Powtoon Pricing](https://www.capterra.com/p/140321/PowToon/pricing/)

### Code-Driven Animation
- [Remotion](https://www.remotion.dev/) / [Remotion vs Motion Canvas](https://www.remotion.dev/docs/compare/motion-canvas)
- [Motion Canvas](https://motioncanvas.io/) / [GitHub](https://github.com/motion-canvas/motion-canvas)
- [From Manim to Motion Canvas](https://slama.dev/motion-canvas/introduction/)
- [Manim Community](https://www.manim.community/) / [Manim for UI Animations — Smashing Magazine 2025](https://www.smashingmagazine.com/2025/04/using-manim-making-ui-animations/)
- [handanim — whiteboard animation library](https://github.com/subroy13/handanim)
- [rough.js](https://roughjs.com/) / [svg2roughjs](https://github.com/fskpf/svg2roughjs) / [rough-notation](https://roughnotation.com/)
- [StoryMotion](https://storymotion.video/) / [HN Discussion](https://news.ycombinator.com/item?id=45102873)
- [ExcaliMotion](https://www.excalimotion.com/)
- [Video as Code comparison (2026)](https://sumeetkg.medium.com/video-as-code-which-library-should-you-choose-8807ac1bda6b)

### AI Video Generation
- [Synthesia Pricing](https://www.synthesia.io/pricing) / [Review](https://www.eesel.ai/blog/synthesia-pricing)
- [HeyGen Pricing](https://www.heygen.com/pricing) / [Review](https://bigvu.tv/blog/heygen-ai-avatar-video-generator-complete-review-2026-best-ai-video-generation-tool/)
- [D-ID Pricing](https://www.d-id.com/pricing/studio/)
- [Colossyan Pricing](https://www.colossyan.com/pricing)
- [Sora vs Runway vs Pika Comparison](https://pxz.ai/blog/sora-vs-runway-vs-pika-best-ai-video-generator-2026-comparison)

### AI Voice Synthesis
- [ElevenLabs Pricing](https://elevenlabs.io/pricing) / [v3 Features](https://tech-now.io/en/blogs/elevenlabs-v3-next-gen-ai-voices-features-use-cases-pricing-2025)
- [Murf.ai Pricing](https://murf.ai/pricing) / [Review](https://qcall.ai/murf-ai-review)
- [OpenAI TTS Pricing](https://platform.openai.com/docs/pricing)
- [Google Cloud TTS Pricing](https://cloud.google.com/text-to-speech/pricing)
- [Amazon Polly Pricing](https://aws.amazon.com/polly/pricing/)
- [Play.ht Review](https://qcall.ai/play-ht-review)
- [WellSaid Labs Review](https://qcall.ai/wellsaid-labs-review)
- [Best TTS APIs 2026](https://www.speechmatics.com/company/articles-and-news/best-tts-apis-in-2025-top-12-text-to-speech-services-for-developers)
- [Bark on GitHub](https://github.com/suno-ai/bark)

### Screen Recording
- [Screen Studio](https://screen.studio/) / [Review](https://efficient.app/apps/screen-studio)
- [FocuSee](https://focusee.imobie.com/) / [Pricing](https://focusee.imobie.com/pricing.htm) / [vs Screen Studio](https://toolquestor.com/vs/focusee-vs-screen-studio)
- [ScreenFlow](https://www.softwareadvice.com/video-editing/screenflow-profile/)
- [Camtasia Pricing Transition](https://support.techsmith.com/hc/en-us/articles/27009223314701)
- [Best Screen Recording Software 2026](https://kommodo.ai/blog/best-screen-recording-software)
- [Loom Pricing](https://supademo.com/blog/loom-pricing)
- [CleanShot X](https://cleanshot.com/pricing)
- [Airtime (mmhmm)](https://www.airtime.com/blog/mmhmm-becomes-airtime)

### Hybrid Approaches
- [Recording Excalidraw to Video](https://giuseppegurgone.com/record-excalidraw)
- [Keynote Demo Videos — Grumo Media](https://grumomedia.com/how-create-a-great-product-demo-video-using-keynote/)
- [Developer Screencasts with Keynote](https://www.howtocode.io/posts/developer-experience/how-to-create-developer-screencasts-with-keynote)
- [Canva AI Video](https://www.canva.com/newsroom/news/canva-video/)

## Recommendation

**For the Aigon demo video, I recommend a two-tier approach based on timeline:**

### Quick Win (3-5 hours, ~$9/mo): Keynote + Screen Studio + ElevenLabs

1. **Concept explanation (~60s):** Keynote slides with hand-drawn assets (import from Excalidraw or use sketchy fonts/shapes). Use Magic Move transitions to animate between states. Explain what Aigon manages and the Drive/Fleet/Swarm modes visually.
2. **Live demo (~60s):** Screen Studio recording of Aigon in action. Auto-zoom and cursor effects make terminal work look polished.
3. **Narration:** ElevenLabs free tier for natural voiceover.
4. **Stitch:** ScreenFlow or iMovie to combine the segments.

**Why this works:** $9/mo (Screen Studio) + free tools. Keynote is the most repeatable format — update a slide when features change, re-export. Screen Studio makes re-recording fast when the product UI changes. Total cost under $10/mo.

### Ambitious Path (1-2 weeks, $0): Remotion + rough.js

If repeatability and "video as code" appeal to you:
1. Build the entire video in Remotion with rough.js for hand-drawn aesthetics
2. Embed screen recordings as video clips within the Remotion composition
3. Version control the entire video as a React project
4. Re-render on demand when features change

**Why this works:** $0 ongoing cost (Remotion is free for individuals). Maximum repeatability. But the initial investment is 10-20 hours to learn Remotion and build the template.

**My recommendation: Start with the Quick Win approach.** It gets a video shipped in a weekend. If you find yourself updating it frequently and the manual process becomes painful, invest in the Remotion pipeline later.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| demo-video-keynote | Create a Keynote deck with hand-drawn assets explaining Aigon's Drive/Fleet/Swarm modes | high | none |
| demo-video-screen-recording | Record a polished screen capture of Aigon workflow using Screen Studio | high | none |
| demo-video-voiceover | Generate natural AI narration for the demo using ElevenLabs | medium | demo-video-keynote |
| demo-video-stitch | Combine concept and demo segments into a final 2-minute video | medium | demo-video-keynote, demo-video-screen-recording, demo-video-voiceover |
| demo-video-remotion-pipeline | Build a Remotion + rough.js "video as code" pipeline for fully repeatable rendering | low | none |
| demo-video-excalidraw-assets | Create hand-drawn concept diagrams in Excalidraw for use in slides and animations | medium | none |
