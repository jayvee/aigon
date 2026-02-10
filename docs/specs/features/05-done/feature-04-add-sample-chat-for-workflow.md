# Purpose
Here is a sample chat history which demonstrates creating a feature and starting a bakeoff.
Please add this to the README.md in a section at the bottom. Can you highlight the text with colour in a way that shows
1. the prompts the user writes (starts with >) 
2. the responses from the agent and 
3. the responses that are specifically guiding the user through the aigon workflow 

# Details
> Can you create a feature called "show-current-project" in that feature, I want to show the current project at the top of the page in a new pane or banner area that is independant of the ai builder or the advanced edit mode. Right now it is not clear what the current project 
is. Please add information to the feature based on this prompt. Use the best possible UX approach. 

⏺ I'll create a comprehensive feature spec for showing the current project. Let me use the Aigon workflow:

> /aigon-feature-create is running… show-current-project 

⏺ Bash(aigon feature-create show-current-project)
  ⎿  ✅ Created: ./docs/specs/features/01-inbox/feature-show-current-project.md                 
     📝 Edit the spec, then prioritise it using command: feature-prioritise show-current-project

⏺ Read(docs/specs/features/01-inbox/feature-show-current-project.md)
  ⎿  Read 34 lines

⏺ Write(docs/specs/features/01-inbox/feature-show-current-project.md)
  ⎿  Updated docs/specs/features/01-inbox/feature-show-current-project.md with 184 additions and 17 removals                                      
    

⏺ Perfect! I've created a comprehensive feature spec for "Show Current Project" at:
  docs/specs/features/01-inbox/feature-show-current-project.md

  What I Included:
...

  Next step: Run aigon feature-prioritise show-current-project to assign an ID and move it to the backlog!

  Would you like me to prioritize this feature now, or would you like to review/modify the spec first?

> yes please prioritise 

⏺ Bash(aigon feature-prioritise show-current-project)
  ⎿  ✅ Moved: feature-show-current-project.md -> 02-backlog/feature-50-show-current-project.md
     Running git: git add docs/specs/features/
     Running git: git commit -m "chore: prioritise feature 50 - move to backlog"
     … +8 lines (ctrl+o to expand)

⏺ Perfect! Feature prioritized as feature-50-show-current-project and moved to backlog.

  Next Steps:

  To implement now:
  aigon feature-implement 50

  Or for a bakeoff (multiple agents):
  aigon bakeoff-setup 50 cc cx gg

  Would you like me to implement this feature now, or save it for later?

> can you setup a bakeoff for 50 with cc cx gg 

⏺ Bash(aigon bakeoff-setup 50 cc cx gg)
  ⎿  ✅ Moved: feature-50-show-current-project.md -> 03-in-progress/feature-50-show-current-project.md
     Running git: git add docs/specs/features/
     Running git: git commit -m "chore: start feature 50 - move spec to in-progress"
     … +33 lines (ctrl+o to expand)

⏺ Perfect! Bakeoff setup complete for feature 50 with 3 agents 🏁

  Worktrees Created:

  | Agent | Path                                  | Port | Branch                             |
  |-------|---------------------------------------|------|------------------------------------|
  | cc    | ../feature-50-cc-show-current-project | 3001 | feature-50-cc-show-current-project |
  | cx    | ../feature-50-cx-show-current-project | 3003 | feature-50-cx-show-current-project |
  | gg    | ../feature-50-gg-show-current-project | 3002 | feature-50-gg-show-current-project |

  Next Steps:

  1. Open each worktree in a separate Claude Code session (3 separate windows/tabs)
  2. In each worktree, run:
  aigon bakeoff-implement 50
  3. Each agent will independently implement the feature based on the spec
  4. When all are done, return to this main repo and run:
  aigon feature-eval 50
  4. This will evaluate all implementations and suggest a winner

  Logs Created:

  - ./docs/specs/features/logs/feature-50-cc-show-current-project-log.md
  - ./docs/specs/features/logs/feature-50-cx-show-current-project-log.md
  - ./docs/specs/features/logs/feature-50-gg-show-current-project-log.md

  Each agent can now work in parallel on their own implementation! 🚀