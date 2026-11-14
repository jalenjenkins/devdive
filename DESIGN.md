---
name: Downstack
description: A daily descent through the computing stack
colors:
  background: "#101010"
  panel: "#171717"
  text: "#f0eee8"
  muted: "#a5a39c"
  border: "#4e4d49"
  primary: "#f14b32"
  primary-hover: "#ff6b53"
typography:
  display:
    fontFamily: "Press Start 2P, monospace"
    fontWeight: 400
    lineHeight: 1.8
  body:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "16px"
    lineHeight: 1.65
rounded:
  none: "0px"
spacing:
  sm: "12px"
  md: "24px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.none}"
    padding: "22px 28px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.background}"
---

# Design System: Downstack

## Overview

**Creative North Star: "The computer elevator"**

A restrained pixel arcade. A small vermilion elevator descends through a monochrome computer. Play is quiet and focused; reveal is the reward. Decoration stays in the shaft, with plain reading surfaces for the question, timer, and input.

## Colors

Warm white on near-black provides the reading contrast. Gray carries secondary labels. Vermilion marks the action and current location; use labels and shapes alongside color. Rarity is represented by six white marks, never a rainbow of UI colors. Purple, yellow, and green themes are excluded by the approved brief.

## Typography

Self-host Press Start 2P, including its SIL Open Font License. The wordmark, prompt, HUD, startup rank, points, and primary controls use this pixel family. Supporting copy and editable answers use a system monospace for legibility. Prompts scale from 17–27px on phones to 20–32px on desktop, with generous line spacing and safe wrapping for long content.

## Layout

Desktop uses a maximum 1440px shell, persistent left depth shaft, and flexible right playfield. At 1100px the shaft narrows. At 760px and below, current meters and layer stay above the prompt and the vertical map moves into an accessible native disclosure. It closes when entering timed play. Controls remain at least 44px high. Question, input, and timer take priority over decoration on phones.

## Elevation & Depth

Flat reading surfaces and fine separators. Hard offset edges are intentional pixel-arcade button material. The elevator's one descent transition is the signature motion; reduced-motion preferences remove animation and transitions.

## Shapes

Square inputs, crisp pixel icons, and small stepped button edges. No rounded cards or glass effects. The illustrated shaft is a generated raster asset; interactive text, labels, and controls remain semantic HTML.

## Components

- **Depth shaft:** seven real meter thresholds, with continuous position proportional to meters, current-step semantics, and cumulative depth text. The marker clamps at Silicon while the numeric depth can continue beyond 7000m.
- **Timer:** numeric seconds plus a segmented proportional meter. Below five seconds, include explicit low-time text and one assistive announcement. Do not flash.
- **Input:** visible label, clear focus ring, no spelling correction. Submit by button or Enter. Pending requests disable the input and show Checking. Failures preserve the draft.
- **Reveal:** canonical answer, startup title, plain rarity description, six marks, earned points/meters, cumulative score, existing fact and deep cuts. Keep depth context visible. No-match and timeout have their own text and icon. Next starts the next server timer.
- **Results:** seven tier values with accessible answer-rank descriptions, final score, meters, leaderboard, and a clipboard fallback exposing selectable text.

## Do's and Don'ts

- **Do** keep all prompt and HUD typography in the pixel family.
- **Do** preserve keyboard focus and text equivalents for state changes.
- **Do** keep startup ranks distinct from computing layers and question progress.
- **Don't** invent answer-frequency percentages, extra currencies, lives, or XP.
- **Don't** put illustrated textures behind essential text.
- **Don't** reset legacy daily player storage on a rebrand.
