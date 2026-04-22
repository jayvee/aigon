# Implementation Log: Feature 313 - recommended-model-on-create
Agent: cc

## Plan

## Progress
- Extended `parseFrontMatter` with inline `{}` map support rather than adding a YAML dependency; added `lib/spec-recommendation.js` as the single resolver feeding both dashboard API and the backlog badge collector.

## Decisions
