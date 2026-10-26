// What the stage paints from [ui; stream C fills it in] (docs/research/LIVE-ROOM-MODE.md §3, §9.6): the room's view
// (core/liveroom/session.js readRoom) with the session's state (ui.state.liveRoom: the selected card, the side, the
// run) and the deck's, in one place for the stage, the setlist and the scene. Nothing in it lives in the DOM.
//
// It exports nothing yet: stream C writes it.
export {};
