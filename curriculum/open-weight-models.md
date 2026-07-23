---
slug: open-weight-models
title: Open weight models
shortTitle: Open weights
level: Advanced
difficulty: 72
blurb: Why inspectable model weights matter for sovereign AI, local inference, procurement, and long-term operational independence.
hypothesis: Open weight models turn inference from a rented endpoint into an inspectable component of owned infrastructure.
---

## Hypothesis

Open weight models turn inference from a rented endpoint into an inspectable component of owned infrastructure.

## Problem

Closed API models can be powerful, but they are not owned infrastructure. The provider controls model access, version changes, logging policy, pricing, acceptable use, availability, and sometimes the safety behavior that shapes outputs.

For sovereign systems, this creates a dependency problem. Even if the entity, keys, memory, and commands are local, inference may still be rented from a remote governor.

## Solution served by koad:io

koad:io treats model inference as a replaceable runtime behind the entity/harness boundary. Open weight models can run locally or on controlled servers while the entity model, trust bonds, command cascade, and session history remain unchanged.

The model becomes one component in the stack, not the owner of the stack.

## Technical model

- Open weights can be hosted with local inference engines such as Ollama, vLLM, llama.cpp, or equivalent runtimes.
- Entity defaults select provider/model through the environment cascade.
- Harness sessions assemble context and tool policy independently of the model provider.
- Bond gate enforcement remains outside the model.
- The same entity can swap model backends without rewriting its identity.

## Install / setup path

1. Choose an open weight model that fits hardware, license, and task profile.
2. Install a local inference runtime.
3. Set the entity's provider/model defaults in `.env`.
4. Run a harness session against the local model.
5. Compare behavior against a cloud model for the same bounded task.

## Verification

The entity should be able to run useful work with inference hosted on hardware you control, while keeping the same identity, memory, commands, and bond-gated tool policy.
