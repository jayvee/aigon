# Purpose
Currently, the GitHub README page and other README-related markdown files in the GitHub repo are the source of truth for describing what Aigon is and what Aigon does. Many competitors with open source libraries like Aigon have a dedicated website which showcases the use of Aigon, includes things like videos, includes detailed documentation, and is really a marketing starting point for the library. This feature is to build a static website for Aigon

# Target Audience
- AI-savvy developers looking to improve their development workflow
- Teams wanting to coordinate multiple AI agents
- Open source contributors evaluating the tool
- Engineering leaders researching AI-assisted development tools

# Inspiring Websites to Learn From

## AI & Developer Tools with Excellent Website Design

1. **[Broomy](https://broomy.org/)** - Terminal-based AI agent manager
   - **What works**: Clean vertical scrolling narrative, alternating text-image sections, color-coded feature labels
   - **Key takeaway**: Addresses pain points directly ("Terminal tabs everywhere. Which agent finished?"), builds trust through transparency (MIT licensed, no telemetry)
   - **Visual style**: Desktop app screenshots with depth/shadows, clear CTAs, tech stack badges

2. **[Zed](https://zed.dev/)** - Next-gen code editor
   - **What works**: Focus on "multiplayer" collaboration concept, GPU-accelerated performance messaging
   - **Key takeaway**: Philosophy-driven narrative (treating coding as social activity), clear differentiation from competitors
   - **See also**: [Zed AI](https://zed.dev/ai) and [Agentic Editing](https://zed.dev/agentic) pages for feature-specific storytelling

3. **[Vite](https://vite.dev/)** - Frontend build tool
   - **What works**: "Next Generation Frontend Tooling" positioning, extremely fast performance claims with proof
   - **Key takeaway**: Speed metrics prominently displayed, clear comparison to alternatives
   - **Design**: Clean, modern, performance-focused messaging

4. **[Astro](https://astro.build/)** - Static site generator
   - **What works**: Component islands architecture explained visually, framework-agnostic messaging
   - **Key takeaway**: Technical concepts simplified through diagrams and interactive examples
   - **Design**: Gradients, modern aesthetic, approachable tone

5. **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
   - **What works**: Interactive code examples, live preview demos, "rapidly build modern websites without ever leaving your HTML"
   - **Key takeaway**: Show, don't just tell - interactive demos throughout
   - **Design**: Premium feel, polished components, Tailwind UI showcase

6. **[Raycast](https://raycast.com/)** - Productivity tool for developers
   - **What works**: Video demos of actual usage, extension ecosystem highlighted
   - **Key takeaway**: Focus on workflow integration and extensibility
   - **Design**: Sleek macOS-native aesthetic, keyboard-first interactions shown

7. **[Stripe](https://stripe.com/docs)** - Payment API documentation
   - **What works**: Multi-language code examples side-by-side, quick start guides, clonable sample apps
   - **Key takeaway**: Developer experience prioritized, get started in minutes
   - **Design**: Three-panel layout, clean navigation, searchable

8. **[Docusaurus](https://docusaurus.io/)** - Documentation site generator (by Meta)
   - **What works**: Meta-documentation (docs about building docs), versioning showcase
   - **Key takeaway**: Built with the tool it documents, proving its capabilities
   - **Tech stack**: React-based, MDX support, plugin ecosystem

9. **[Ralph](https://snarktank.github.io/ralph/)** - Original inspiration
   - **What works**: State machine / flow diagram showing the complete workflow visually
   - **Key takeaway**: Complex workflows made simple through visual representation
   - **Design**: Interactive diagrams, clear state transitions

10. **[Streamlit](https://streamlit.io/)** - Python app framework
    - **What works**: "Turn Python scripts into web apps in minutes", live examples
    - **Key takeaway**: Time-to-value messaging, simple getting started
    - **Design**: Bright, approachable, example gallery

**References**:
- [Top 12 Open Source AI Platforms](https://www.digitalocean.com/resources/articles/open-source-ai-platforms)
- [20 Open-Source AI Tools for Building & Deploying ML Projects](https://jozu.com/blog/20-open-source-tools-i-recommend-to-build-share-and-run-ai-projects/)
- [12 Documentation Examples Every Dev Tool Can Learn From](https://draft.dev/learn/12-documentation-examples-every-developer-tool-can-learn-from)

# Tools for Animated CLI Demos

## Terminal Recording & Animation Tools

These tools will help create compelling, error-free demonstrations of Aigon's CLI workflow:

### 1. **[Asciinema](https://asciinema.org/)** - Terminal session recorder
   - **What it does**: Records terminal sessions as text (not video), preserving exact timing
   - **Output formats**: Embeddable web player, GIF (via agg), animated SVG (via svg-term-cli)
   - **Best for**: Lightweight recordings, copy-paste-able demos, web embedding
   - **Why choose**: Straightforward to install, minimal configuration, recordings are text-based (small file size)
   - **Install**: `brew install asciinema`
   - **Usage**: `asciinema rec demo.cast` → press ctrl+d to stop

### 2. **[VHS](https://github.com/charmbracelet/vhs)** - Programmatic terminal recording
   - **What it does**: Write terminal GIFs as code (scriptable, repeatable demos)
   - **Output formats**: GIF, MP4, WebM
   - **Best for**: Documentation in CI pipelines, pixel-perfect demos, avoiding typos/fumbling
   - **Why choose**: Highly configurable, supports higher frame rates, scriptable for automation
   - **Install**: `brew install vhs`
   - **Usage**: Write a `.tape` file describing the terminal session, then `vhs demo.tape`

### 3. **[Demo Magic](https://github.com/paxtonhare/demo-magic)** - Live demo automation
   - **What it does**: Bash functions that simulate typing and run commands
   - **Best for**: Live presentations, showcases as shell scripts
   - **Why choose**: Makes it look like you're typing in real-time during presentations
   - **Usage**: Source the script, use `pe` (print and execute) and `wait` commands

### 4. **[Terminalizer](https://terminalizer.com/)** - Highly customizable recorder
   - **What it does**: Generates YAML from terminal session, editable before rendering
   - **Best for**: Fine-tuning recordings after capture, fixing mistakes
   - **Why choose**: Edit the YAML file to fix typos or adjust timing before rendering

### 5. **[demo](https://github.com/saschagrunert/demo)** - Framework for pre-recorded demos
   - **What it does**: Golang-based tool for creating scripted demonstration sequences
   - **Best for**: Professional, error-free live demonstrations
   - **Why choose**: Built for performing pre-recorded demos in the wild

### 6. **[It's a Live](https://github.com/itsalive/itsalive)** - Simulated typing
   - **What it does**: Writes one character from a file every time you press a key
   - **Best for**: Live presentations where you want to "type" perfectly
   - **Why choose**: Makes it look like you're typing without risk of errors

**Recommended approach for Aigon**:
- **VHS** for documentation and README demos (repeatable, scriptable, professional)
- **Asciinema** for interactive web demos (embeddable player, lightweight)
- **Demo Magic** for live presentations at conferences

**References**:
- [awesome-terminal-recorder](https://github.com/orangekame3/awesome-terminal-recorder) - Curated list of terminal recording tools
- [Recording terminal sessions using asciinema](https://sadman.ca/blog/software-showcase-01-asciinema/)
- [Make Your CLI Demos a Breeze](https://martinheinz.dev/blog/94)

# Flow Diagram & Visualization Tools

## Tools for Creating the "Loop" Visualization

The core Aigon loop (Research → Features → Feedback → repeat) needs compelling visual representation:

### 1. **[Mermaid](https://mermaid.live/)** - Diagram-as-code
   - **What it does**: Create diagrams using text-based syntax (flowcharts, sequence diagrams, state machines)
   - **Output formats**: SVG, PNG, embedded in markdown
   - **Best for**: Version-controlled diagrams, GitHub/GitLab integration
   - **Why choose**: Lives in your codebase, renders on GitHub, widely supported
   - **Example syntax**:
     ```mermaid
     graph LR
         Feedback --> Research
         Research --> Features
         Features --> Code
         Code --> Feedback
     ```
   - **Integration**: VS Code extensions, GitHub markdown rendering, static site generators

### 2. **[Excalidraw](https://excalidraw.com/)** - Hand-drawn style diagrams
   - **What it does**: Create sketchy, hand-drawn style diagrams with a friendly aesthetic
   - **Output formats**: SVG, PNG, excalidraw JSON
   - **Best for**: Approachable, non-corporate feel; collaborative editing
   - **Why choose**: Open source, self-hostable, popular in developer communities
   - **Workflow**: Start with Mermaid code → convert with [mermaid-to-excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw) → refine in Excalidraw
   - **Obsidian integration**: Available as plugin for note-taking workflows

### 3. **[D2](https://d2lang.com/)** - Declarative diagramming language
   - **What it does**: Modern diagram-as-code with beautiful default styling
   - **Best for**: Complex layouts, auto-routing, professional appearance
   - **Why choose**: Better aesthetics than Mermaid out-of-the-box, modern syntax

### 4. **[Rive](https://rive.app/)** - Motion design tool
   - **What it does**: Create interactive, animated graphics
   - **Best for**: Animated loop visualization, interactive homepage hero
   - **Why choose**: Export to web (runtime is small), design in GUI, animate with state machines
   - **Output**: Runtime for web, iOS, Android, Flutter

### 5. **[Lottie](https://lottiefiles.com/)** - Lightweight animations
   - **What it does**: JSON-based animation format (After Effects → web)
   - **Best for**: Smooth, performant animations on web
   - **Why choose**: Industry standard, small file size, broad support
   - **Workflow**: Design in After Effects → export with Bodymovin → embed on web

### 6. **Custom Interactive Diagrams** (for homepage)
   - **React Flow** - Build interactive node-based diagrams in React
   - **Cytoscape.js** - Graph theory visualization
   - **D3.js** - Data visualization library (full control, steep learning curve)

**Recommended approach for Aigon**:
1. **Static documentation**: Mermaid (lives in markdown, renders on GitHub)
2. **Website loop visualization**: Excalidraw (approachable, hand-drawn aesthetic matches developer tool vibe)
3. **Animated homepage hero**: Rive or Lottie (engaging, shows the flow in motion)
4. **Interactive diagram**: Plain JavaScript or simple SVG manipulation (keeping with the zero-dependency approach)

**References**:
- [Create Diagrams Using ChatGPT, Mermaid, and Excalidraw](https://spin.atomicobject.com/diagrams-mermaid-excalidraw/)
- [Mermaid to Excalidraw Playground](https://mermaid-to-excalidraw.vercel.app/)

# Sections to Include on the Website

## 1. Hero Section
- **Headline**: "Spec-Driven Development for AI Agents" or "Coordinate Multiple AI Agents, Ship Better Code"
- **Subheadline**: Brief explanation of the problem Aigon solves
- **CTA**: GitHub link + Download/Install button
- **Visual**: Animated loop diagram (Research → Features → Feedback → Code) using SVG animation or Lottie

## 2. The Problem
- "AI agents everywhere. Which feature is in progress? What did the team decide?"
- Terminal tabs chaos, lost context, competing implementations
- Pain point: No coordinated workflow for multi-agent development

## 3. The Solution - Core Features
Each feature with animated CLI demo (VHS/Asciinema):

### Research Arena
- **What**: Multiple AI agents research the same topic simultaneously
- **Demo**: `aigon research-setup 05 cc gg cx` → side-by-side comparison
- **Benefit**: Best ideas win through competitive research

### Feature Workflow
- **What**: Spec → Branch/Worktree → Implement → Review → Merge
- **Demo**: `aigon feature-now dark-mode` → fast-track feature implementation
- **Benefit**: Traceability from idea to code

### Feedback Loop
- **What**: Capture user feedback → triage → link to features
- **Demo**: `aigon feedback-triage 14` → AI-assisted classification
- **Benefit**: Close the loop, never lose customer insights

### Arena Mode
- **What**: AI agents compete on same feature (code bakeoff)
- **Demo**: `aigon feature-setup 100 cc gg cx cu` → 4 implementations side-by-side
- **Benefit**: Best implementation wins, learn from alternatives

## 4. The Big Picture - Flow Diagram
- **Inspiration**: Ralph's state machine diagram
- **Content**: Show the complete lifecycle:
  1. Research → Findings → Feature Specs
  2. Feature Specs → Branch/Worktrees → Implementation
  3. Implementation → Code Review → Merge → Production
  4. Production → User Feedback → back to Research
- **Interactivity**: Clickable regions or hover effects to highlight different phases
- **Tool**: SVG with CSS/JavaScript animations (keeping with zero-dependency approach)

## 5. How It Works - Workflow Steps
Step-by-step guide with code snippets:
1. Initialize: `aigon init && aigon install-agent cc gg`
2. Research: `aigon research-create "auth-strategy"`
3. Implement: `aigon feature-now jwt-auth`
4. Feedback: `aigon feedback-create "Login slow"`
5. Triage: `aigon feedback-triage 15`

## 6. Documentation
- Quick Start
- CLI Reference (searchable)
- Agent Setup (Claude, Gemini, Cursor, Codex)
- Arena Mode Guide
- Hooks & Customization
- Project Profiles (web, api, ios, android, library)

## 7. Tech Stack & Philosophy
- **Open Source**: MIT licensed, no telemetry, no paid tier
- **Tech**: Node.js CLI, git worktrees, agent-agnostic
- **Philosophy**: Spec-driven, traceability, competitive collaboration
- **Badges**: TypeScript, tested, version, license

## 8. Community & Contributing
- GitHub stars/contributors
- Contributing guide
- Discord/Slack community link
- Roadmap

## 9. Footer
- GitHub, Docs, Changelog
- Created by [author name]
- MIT License

# Success Metrics

How we'll know the website is effective:
- **Clarity**: Can a new user understand what Aigon does in 30 seconds?
- **Action**: Do they know how to install and start using it?
- **Conversion**: GitHub stars, npm downloads increase
- **Engagement**: Time on site, scroll depth, demo video plays
- **Community**: GitHub issues, discussions, contributions increase
