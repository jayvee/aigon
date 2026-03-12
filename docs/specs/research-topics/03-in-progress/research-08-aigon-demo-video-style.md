# Research: aigon-demo-video-style

## Context

Aigon needs a ~2-minute demonstration video that communicates the key concepts at a high level: what Aigon manages, and the Drive / Fleet / Swarm modes. The current aigon.build website is information-dense with terminal emulation demos, but lacks a visual, approachable overview video.

The user is a visual person and is drawn to the hand-drawn / whiteboard explainer style — where concepts are illustrated with sketched diagrams and a voiceover narrates the flow. The challenge: the user isn't confident in their own drawing ability, so automated or semi-automated hand-drawn animation tools are of particular interest.

This research should evaluate tooling options across the spectrum — from simple screen recordings to fully scripted whiteboard-style animations — with a bias toward approaches that are **quick to produce, repeatable** (easy to re-render when Aigon changes), and suitable for a solo developer without a video production background.

## Questions to Answer

- [ ] What tools exist for creating hand-drawn / whiteboard-style explainer videos? (e.g. Doodly, VideoScribe, Animaker, CreateStudio, etc.)
- [ ] Which of these support scripted/automated workflows where you define scenes declaratively rather than manually drawing frame-by-frame?
- [ ] Are there any open-source or code-driven alternatives (e.g. Manim, Motion Canvas, Remotion) that could generate hand-drawn-style animations from a script?
- [ ] What AI-powered video generation tools (e.g. Synthesia, HeyGen, D-ID) could synthesise a presenter or voiceover, and do any support a sketched/whiteboard visual style?
- [ ] What are the best AI voice synthesis options for a natural-sounding narration? (e.g. ElevenLabs, Play.ht, WellSaid)
- [ ] How do traditional screen recorders (OBS, Loom, Kap) compare in effort and output quality for a product demo like this?
- [ ] What was the user's previous experience with Farline (or similar), and what worked / didn't work about that approach?
- [ ] What is the realistic effort (hours) and cost ($) for each approach to produce a 2-minute video?
- [ ] Which approach best supports **repeatability** — i.e. re-rendering the video when features change, without starting from scratch?
- [ ] Are there hybrid approaches (e.g. hand-drawn diagrams for concepts + screen recording for demo portions) that combine the best of both?

## Scope

### In Scope
- Tool and platform comparison for creating short explainer/demo videos
- Hand-drawn / whiteboard animation tools and their automation capabilities
- AI voice synthesis for narration
- Code-driven animation frameworks that could produce a sketch-style aesthetic
- Cost and effort estimation per approach
- Repeatability and maintainability of each approach

### Out of Scope
- Actually producing the video or writing the script
- Video hosting, distribution, or marketing strategy
- Long-form content (webinars, tutorials, courses)
- Aigon website redesign or landing page changes
- Professional video production services or hiring freelancers

## Inspiration

- Hand-drawn whiteboard explainer style (RSA Animate, Minute Physics)
- The user has previously used Farline for screen recording
- Code-driven animation (3Blue1Brown's Manim) adapted for product demos
- AI-generated presenters (Synthesia-style) as a possible alternative
