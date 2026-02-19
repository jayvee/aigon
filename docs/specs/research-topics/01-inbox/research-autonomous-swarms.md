# Purpose
Currently, Aigon can spin up Arena mode with different agents working on the same feature and can even work with one agent on multiple features at the same time through solo work trees. But right now, you wouldn't call this a true swarm, and it still requires much manual intervention from me as the developer in multiple terminal windows to test and submit features for evaluation. This research is to determine what needs to be done to Aigon to move it into a true swarm controller capability. 

# Capabilities
When a feature is set up to run in an Arena Mode with three agents, the developer should be able to kick off those agents in the background. The agents should run in a loop, attempting to satisfy the very specific definitions of done for that feature. They should not stop or pause for user input until it is complete. It should check in its own work and then report back to a central controller to ensure that the work is done. That controller should automatically evaluate all the agents and pick the correct one, therefore reducing much of the manual intervention. 
This controller or conductor should effectively create a swarm of agents for a feature and could create multiple swarms of agents for multiple features in parallel. Swarm of swarms. 

# Inspiration
- Claude Flow
- Ralph - https://ghuntley.com/ralph/
- Chief - https://minicodemonkey.github.io/chief/
