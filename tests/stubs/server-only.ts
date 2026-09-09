// `server-only` deliberately throws unless resolved under the react-server condition.
// Tests exercise server modules directly in Node, so it is stubbed here. The guard
// still does its real job in the application bundle.
export {}
