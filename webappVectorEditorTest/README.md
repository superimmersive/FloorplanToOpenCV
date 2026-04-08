# Grid Vector Editor (MVP)

React + TypeScript grid-based vector editor prototype following `vector-editor-spec.md`.

## Tech Stack

- React
- TypeScript
- Vite
- HTML Canvas

## Getting Started

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Then open the printed local URL in your browser.

## Implemented Tasks

- **Task 1**: React project structure with modular folders:
  - `src/editor`
  - `src/geometry`
  - `src/tools` (stub, future)
  - `src/render`
  - `src/ui`
  - `src/state`
- **Task 2**: Canvas viewport with pan and zoom using `Camera2D`.
- **Task 3**: Grid renderer with 10mm, 100mm, and 1000mm layers, with zoom-based visibility rules.

Next steps per spec:

- Polygon rendering, edge hit testing, selection, AddPoint and Extrude tools, Clipper2 integration, and measurement tool.
