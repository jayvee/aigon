Feature prioritised as #28. It's been moved to the backlog.
                                                                                                                                                  
  Next, set up the feature for implementation:                                                                                                    
  
  /aigon:feature-start 28                                                                                                                         
                                                                                                                                                
❯ /aigon:feature-start 28 cc cu cx                                                                                                                
                                   
⏺ Bash(aigon feature-start 28 cc cu cx)                                                                                                           
  ⎿  ✅ Moved: feature-28-export-all-user-data.md -> 03-in-progress/feature-28-export-all-user-data.md                                          
     Running git: git add docs/specs/features/                                                                                                    
     Running git: git commit -m "chore: start feature 28 - move spec to in-progress"
     … +41 lines (ctrl+o to expand)                                                                                                               
                                                                                                                                                  
⏺ Arena is set up for feature #28 with 3 agents competing:
  ┌──────────────────┬────────────────────────────────────┬──────┐                                                                                
  │      Agent       │              Worktree              │ Port │                                                                                
  ├──────────────────┼────────────────────────────────────┼──────┤
  │ cc (Claude Code) │ feature-28-cc-export-all-user-data │ 3801 │                                                                                
  ├──────────────────┼────────────────────────────────────┼──────┤                                                                              
  │ cu (Cursor)      │ feature-28-cu-export-all-user-data │ 3804 │
  ├──────────────────┼────────────────────────────────────┼──────┤
  │ cx (Codex)       │ feature-28-cx-export-all-user-data │ 3803 │
  └──────────────────┴────────────────────────────────────┴──────┘
  Open all worktrees to start the competition:

  /aigon:worktree-open 28

❯ /aigon:worktree-open 28                                                                                                                         
                          
⏺ Bash(aigon worktree-open 28)                                                                                                                    
  ⎿  ℹ️  Multiple worktrees found, opening most recent:                                                                                          
        → 28-cx: /Users/jviner/src/when-swell-worktrees/feature-28-cx-export-all-user-data                                                        
          28-cu: /Users/jviner/src/when-swell-worktrees/feature-28-cu-export-all-user-data
     … +7 lines (ctrl+o to expand)                                                                                                                
                                                                                                                                                  
⏺ That opened only the cx (Codex) worktree. Let me open the other two as well.
                                                                                                                                                  
⏺ Bash(aigon worktree-open 28 cc)                                                                                                                 
  ⎿  🚀 Opening worktree in Warp:
        Feature: 28 - export-all-user-data                                                                                                        
        Agent: cc                                                                                                                               
     … +2 lines (ctrl+o to expand)                                                                                                                
                                                                                                                                                  
⏺ Bash(aigon worktree-open 28 cu)
  ⎿  🚀 Opening worktree in Warp:                                                                                                                 
        Feature: 28 - export-all-user-data                                                                                                        
        Agent: cu
     … +2 lines (ctrl+o to expand)                                                                                                                
                                                                                                                                                  
⏺ All 3 worktrees are now open in Warp:
  ┌──────────────────┬──────────┬─────────────────────────────┐                                                                                   
  │      Agent       │  Status  │           Command           │                                                                                   
  ├──────────────────┼──────────┼─────────────────────────────┤
  │ cc (Claude Code) │ Launched │ /aigon:feature-implement 28 │                                                                                   
  ├──────────────────┼──────────┼─────────────────────────────┤                                                                                 
  │ cu (Cursor)      │ Launched │ /aigon:feature-implement 28 │
  ├──────────────────┼──────────┼─────────────────────────────┤
  │ cx (Codex)       │ Launched │ /aigon:feature-implement 28 │
  └──────────────────┴──────────┴─────────────────────────────┘
  Each agent is now implementing feature #28 independently in its own worktree. When they're all done, run /aigon:feature-eval 28 to compare the
  implementations.