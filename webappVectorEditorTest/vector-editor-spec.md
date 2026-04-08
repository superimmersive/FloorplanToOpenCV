You are helping build a grid-based vector editor web application.

Follow the specification exactly. Do not invent alternate geometry systems.

The editor is similar to a lightweight CAD system designed for grid-aligned polygon editing.

The application must be implemented using:

React
TypeScript
HTML Canvas

Use a modular architecture.

Folder structure:

src
  editor
  geometry
  tools
  render
  ui
  state

The system must support future features like extrusion and polygon boolean operations.

Use clean, readable code with clear separation between rendering, geometry logic, and UI.

--------------------------------

EDITOR OVERVIEW

The editor is a 2D canvas with an infinite grid measured in millimeters.

Grid layers:

1000 mm
100 mm
10 mm

Each grid layer has a different shade.

Zoom and pan must be supported.

The grid must stay visually consistent during zoom.

--------------------------------

UNITS

All geometry coordinates are stored as integers in grid units.

1 unit = 1 mm.

--------------------------------

DATA MODEL

Use these exact types.

type Vec2 = {
  x: number
  y: number
}

type Polygon = {
  id: string
  verts: Vec2[]
}

type Transform2D = {
  position: Vec2
  rotationDeg: number
  scale: Vec2
}

type VectorObject = {
  id: string
  polygons: Polygon[]
  transform: Transform2D
}

type Camera2D = {
  center: Vec2
  zoom: number
}

type EdgeRef = {
  objectId: string
  polygonId: string
  edgeIndex: number
}

--------------------------------

EDITOR STATE

Create a document state containing:

objects
camera
selection
active tool

--------------------------------

TOOLS

Tools available in the MVP:

Select
Move
Rotate
Scale
AddPoint
Extrude
Measure

--------------------------------

GRID RENDERING

Implement a grid renderer.

The grid must draw three layers:

1000 mm lines
100 mm lines
10 mm lines

When zoomed out, hide smaller grid levels automatically.

Example:

Zoom < threshold -> hide 10mm grid

--------------------------------

EDGE HIT TESTING

Edges must be selectable with a constant screen pixel buffer.

Buffer size = 8 pixels.

Convert buffer to world units using:

bufferWorld = bufferPx / camera.zoom

When objects are scaled, convert to local space.

Distance to edge must use point-to-segment distance.

Implement:

distPointToSegment(p, a, b)

Edge hit test must return the closest edge.

--------------------------------

ADD POINT TOOL

Vertices cannot be dragged.

Vertices can only be added.

AddPoint tool behavior:

1. User clicks an edge
2. Mouse position is projected onto edge
3. Snap projected point to grid
4. Insert vertex between edge endpoints

Reject if point duplicates existing vertex.

--------------------------------

EXTRUDE TOOL

Extrusion only works on edges.

Extrusion must always be perpendicular to the edge.

Extrusion distance can be positive or negative.

Positive extrusion adds geometry.

Negative extrusion subtracts geometry.

Negative extrusion may split shapes into multiple polygons.

Use polygon boolean subtraction for negative extrusion.

Use the Clipper2 library for polygon clipping.

--------------------------------

POSITIVE EXTRUSION

Given edge A->B

Compute outward normal.

Create new vertices:

A2 = A + normal * distance
B2 = B + normal * distance

Insert vertices so edge becomes:

A -> A2 -> B2 -> B

--------------------------------

NEGATIVE EXTRUSION

Create a cut rectangle:

A
B
B + inwardNormal * depth
A + inwardNormal * depth

Subtract rectangle from object polygons using Clipper.

Store resulting polygons back into the object.

--------------------------------

MEASUREMENT TOOL

User clicks start point.

Mouse moves.

Measurement line follows cursor.

Measurement must snap horizontal or vertical.

Display distance in millimeters.

--------------------------------

AREA CALCULATION

Use shoelace formula.

function signedArea(polygon)

Object area = sum of polygon areas.

--------------------------------

RENDERING

Rendering must use HTML Canvas.

Render order:

Grid
Objects
Edge highlights
Selection overlay
Tool previews

--------------------------------

PROJECT TASKS

Start implementing in this order.

Task 1
Create React project structure.

Task 2
Create canvas viewport with pan and zoom.

Task 3
Implement grid renderer.

Task 4
Implement polygon rendering.

Task 5
Implement edge hit testing.

Task 6
Implement object and edge selection.

Task 7
Implement AddPoint tool.

Task 8
Implement Extrude tool (positive extrusion).

Task 9
Integrate Clipper2 and implement negative extrusion.

Task 10
Implement measurement tool.

--------------------------------

IMPORTANT RULES

Vertices cannot be moved.

Only edges can be manipulated.

Extrusion must always be perpendicular.

Geometry coordinates must remain snapped to the grid.

--------------------------------

Start by implementing:

Task 1
Task 2
Task 3

Create the project structure and initial editor canvas.