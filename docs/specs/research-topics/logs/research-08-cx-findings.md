# Research Findings: aigon demo video style

**Agent:** Codex (cx)
**Research ID:** 08
**Date:** 2026-03-13

---

## Key Findings

### 1) “Whiteboard / hand-drawn explainer” tools (mostly GUI-first)

These tools are optimized for fast production via scene editors + asset libraries, but most are **not truly scriptable** (repeatability is “edit the project and re-render”, not “regenerate from source code”).

- **VideoScribe**: classic whiteboard style with a “hand draws assets” aesthetic; quick to assemble if you stay within the library, but custom assets still require prep and manual scene composition.  
- **Doodly**: popular “whiteboard hand drawing” tool; generally positioned as template/editor driven (good for speed, less for declarative automation).  
- **Vyond**: strong for “business explainer” storytelling; “whiteboard” is a style you can choose, but the pipeline remains editor-driven.  
- **Animaker (Whiteboard)**: similar editor-driven approach with templates + assets; fast for non-technical workflows.  
- **CreateStudio**: template-heavy motion graphics tool that includes doodle/whiteboard-style packs; still largely manual in the editor.

**When these win:** you want to ship something in ~1–2 days, you don’t want to build a rendering pipeline, and you’re okay with a manual timeline editor.

**When these lose:** you want “re-render from source” repeatability and/or a repo-native workflow.

### 2) Scripted / automated workflows (declarative scenes)

If “repeatable and re-renderable when Aigon changes” is a top priority, the most reliable approach is to treat the video as **code**:

- **Remotion** (React → video): excellent for building reusable “scene components” (title cards, callouts, diagrams) and re-rendering from data/config. Great fit for a solo dev if you’re comfortable with JS/React.  
- **Motion Canvas** (TypeScript animation engine): similar benefits (code-first scenes, deterministic renders) with a strong animation model.

To get a **hand-drawn look** in a code pipeline, two practical tactics:

1. **Use hand-drawn-style vector assets** (e.g. Excalidraw exports) and animate them in; keep motion simple (pan/zoom, fade, draw-on).  
2. **Apply “sketch” styling** for primitives with libraries like **Rough.js** (or pre-baked sketch-style SVGs) and animate SVG path “draw” reveals.

### 3) Open-source / code-driven alternatives for sketch aesthetics

- **Manim**: very strong for mathematical/diagrammatic animations and fully scripted rendering; steep-ish learning curve but great repeatability.  
- **Blender (Grease Pencil)**: can produce the most authentic “hand-drawn” look, but it’s closer to real animation tooling (time-consuming; repeatability depends on discipline + project organization).

### 4) AI video generation (presenters + “text to video”)

- **Synthesia** / **HeyGen**: great if you want a “presenter talking” format with fast iteration; less aligned with “whiteboard sketch” style, and consistency/control over visuals is generally lower than a designed animation pipeline.

### 5) AI voice synthesis (narration)

- **ElevenLabs** is widely used for natural narration and quick iteration with different tones/voices.  
- **OpenAI Text-to-Speech** is another strong option if you want API-driven generation and easy re-generation as the script changes.
- **Play.ht** / **WellSaid** are also established options if you want “narration-grade” voices and team/workflow features (worth sampling voices + licensing terms).

For a 2-minute demo, AI voice is often the highest-leverage “quality per hour” upgrade vs recording your own VO (assuming you’re comfortable with synthetic voice).

### 6) Screen recording tools (for the “actual product” portion)

- **OBS Studio**: free + powerful, best if you want scene switching, capture sources, and full control.  
- **Loom**: fastest “record and share” workflow; less control, but very low friction.  
- **Kap** (macOS): simple, open-source screen recorder; good for quick clips.

### 7) Farline (user’s prior experience)

This repo references “test in Farline” but doesn’t describe what specifically worked/didn’t. To make this actionable, the key questions to ask (and then bake into the workflow) are:

- Did Farline make **retakes** and **tight edits** easy (cutting pauses, removing “ums”, trimming cursor drift)?
- Was audio capture/cleanup (noise, levels) the main pain?
- Did exporting/publishing formats and sizes cause friction?
- Was repeatability the real issue (changing one feature meant re-recording everything)?

### Effort + cost (rough, for a 2-minute video)

- **Screen recording + VO + basic edits**: ~3–8 hours; $0–$30/mo depending on editor/recorder.
- **Editor-driven whiteboard tool**: ~6–16 hours; typically $15–$80/mo (tool subscription), depending on vendor/tier.
- **Code-driven animation (Remotion/Motion Canvas) + Excalidraw assets + VO**: ~8–24 hours initial (pipeline + first video), then ~1–6 hours for future updates; costs mainly VO ($) and any paid fonts/assets.
- **Blender Grease Pencil (hand-drawn “authentic”)**: ~16–40+ hours; low tool cost, high time cost.

### Repeatability ranking (best → worst)

1. **Code-driven** (Remotion/Motion Canvas) + asset pipeline (Excalidraw/SVG)  
2. **Editor-driven whiteboard tools** (project-editable but manual)  
3. **Screen recordings** (changes often require re-recording)  
4. **Text-to-video AI generation** (fast, but visual consistency/control can be difficult)

## Sources

- VideoScribe pricing/info: https://www.videoscribe.co/en/pricing
- Vyond pricing: https://www.vyond.com/pricing/
- Animaker pricing: https://www.animaker.com/pricing
- CreateStudio pricing: https://createstudio.com/pricing/
- Doodly (home): https://www.doodly.com/
- Remotion docs: https://www.remotion.dev/docs
- Motion Canvas docs: https://motioncanvas.io/docs
- Manim Community docs: https://docs.manim.community/
- Blender Grease Pencil manual: https://docs.blender.org/manual/en/latest/grease_pencil/
- Rough.js (hand-drawn primitives): https://github.com/rough-stuff/rough
- Excalidraw (hand-drawn diagram assets): https://github.com/excalidraw/excalidraw
- Synthesia pricing: https://www.synthesia.io/pricing
- HeyGen pricing: https://www.heygen.com/pricing
- ElevenLabs pricing: https://elevenlabs.io/pricing
- OpenAI Text-to-Speech guide: https://platform.openai.com/docs/guides/text-to-speech
- Play.ht pricing: https://play.ht/pricing/
- WellSaid pricing: https://wellsaidlabs.com/pricing/
- Loom pricing: https://www.loom.com/pricing
- OBS Studio: https://obsproject.com/
- Kap screen recorder: https://github.com/wulkano/kap
- ScreenFlow purchase page: https://www.telestream.net/screenflow/store.asp#buy

## Recommendation

Use a **hybrid** approach that optimizes for (a) speed to first video and (b) long-term repeatability:

1. **Concept segment (Drive/Fleet/Swarm)**: create sketched diagrams in **Excalidraw**, export SVG, animate them with a **code-driven renderer** (Remotion or Motion Canvas). Keep the animation language simple and reusable (title card → diagram draw-on → callout → transition).
2. **Product segment (what Aigon manages)**: record 20–40s of real UI/terminal clips (Kap/OBS), then composite them into the timeline (code-driven or in a traditional editor).
3. **Narration**: generate VO with **ElevenLabs** (or OpenAI TTS if you want a fully script/API-driven workflow), then do minimal post-processing (levels/noise) once and re-use the chain.

This gives you a first version fast enough to ship, while still enabling “change the script/config, re-render, done” for future iterations.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| demo-video-style-guide | A short style guide (visual + voice) for future Aigon demos to keep output consistent. | high | none |
| demo-video-storyboard-template | A storyboard template (scenes, goals, narration) optimized for 90–120s videos. | high | none |
| demo-video-asset-kit-excalidraw | A reusable Excalidraw library (Drive/Fleet/Swarm icons, arrows, callouts) for sketched diagrams. | medium | demo-video-style-guide |
| demo-video-render-pipeline | A repo-local render pipeline (e.g. Remotion) to regenerate the video from source assets + script. | medium | demo-video-storyboard-template |
| demo-video-voiceover-pipeline | A repeatable voiceover workflow (script → TTS → normalization → mixdown) for easy re-renders. | medium | demo-video-storyboard-template |
| demo-video-hybrid-capture-guide | A capture + compositing guide for mixing whiteboard concepts with real terminal/UI clips. | low | demo-video-style-guide |
