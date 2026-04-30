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

# Seed two dummy git repos so the wizard has realistic repos to discover
# (avoids it finding the bind-mounted aigon source as a project to manage)
RUN git init /home/dev/src/acme-web && \
    git -C /home/dev/src/acme-web config user.email "dev@example.com" && \
    git -C /home/dev/src/acme-web config user.name "Dev" && \
    mkdir -p /home/dev/src/acme-web/src && \
    printf '{"name":"acme-web","version":"1.0.0"}\n' > /home/dev/src/acme-web/package.json && \
    printf '# Acme Web\nDummy project for aigon install testing.\n' > /home/dev/src/acme-web/README.md && \
    printf 'console.log("hello");\n' > /home/dev/src/acme-web/src/index.js && \
    git -C /home/dev/src/acme-web add -A && \
    git -C /home/dev/src/acme-web commit -m "init"

RUN git init /home/dev/src/acme-api && \
    git -C /home/dev/src/acme-api config user.email "dev@example.com" && \
    git -C /home/dev/src/acme-api config user.name "Dev" && \
    mkdir -p /home/dev/src/acme-api/src && \
    printf '{"name":"acme-api","version":"1.0.0"}\n' > /home/dev/src/acme-api/package.json && \
    printf '# Acme API\nDummy project for aigon install testing.\n' > /home/dev/src/acme-api/README.md && \
    printf 'module.exports = {};\n' > /home/dev/src/acme-api/src/app.js && \
    git -C /home/dev/src/acme-api add -A && \
    git -C /home/dev/src/acme-api commit -m "init"

# Aigon source will be bind-mounted at /home/dev/src/aigon
# No pre-installed tools — that's the point
CMD ["/bin/bash"]
