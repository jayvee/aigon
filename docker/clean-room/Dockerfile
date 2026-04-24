# Clean-room test environment for Aigon
# Minimal Ubuntu 24.04 — no Node.js, no git, no tmux, no aigon, no agent CLIs
FROM ubuntu:24.04

# Avoid interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# Only install bare minimum: sudo + a shell user
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      sudo \
      ca-certificates \
      curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user with sudo access
RUN useradd -m -s /bin/bash dev && \
    echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    mkdir -p /home/dev/src && \
    chown dev:dev /home/dev/src

# Working directory
WORKDIR /home/dev
USER dev

# Aigon source will be bind-mounted at /home/dev/src/aigon
# No pre-installed tools — that's the point
CMD ["/bin/bash"]
