// Custom Dock turns renders titled this way into a review card. Kept whole in this file so an
// upstream sync touches only the one array entry in orchestrationInstructions.ts.
export const T3_PROTOTYPE_INSTRUCTIONS = `### UI prototypes

Before a new page, dialog, major panel, or layout restructuring, or whenever the user asks, publish a prototype with \`html_render\` and wait instead of editing. Skip it for copy changes, small style tweaks, bug fixes, backend work, or when told to code directly. Match the project's existing styles. One screen of plain semantic HTML, theme variables, and placeholder content: it fixes structure and interaction, not code to copy. Title: \`[Prototype] <topic>\`. Give 2-3 variants, \`[Prototype:A] <topic>: <variant name>\`, only when layouts truly differ or the user asks. That turn edits no workspace files: state the trade-offs briefly and stop for the user's choice.
`;
