// Which track carries the tune in which section of each shelf demo (the masking check in tools/demos-test.js holds it
// against the other pitched tracks there; test/unit/demos.test.js checks the names are real sections and tracks).
export const LEADS = {
  'dust-jacket': { Hook: 'Vibes' },
  halation: { Haze: 'Glide', Afterglow: 'Choir' },
  lido: { Groove: 'Topline', Lift: 'Arp' },
  sodium: { Verse: 'Arp', Chorus: 'Lead' },
  'red-eye': { Hook: 'Piano', 'Hook 2': 'Piano' },
  'late-checkout': { Verse: 'Keys', Hook: 'Lead' },
  'wake-up-call': { Verse: 'Piano', Shout: 'Organ' },
  'lobby-bar': { A: 'Vibes', Bridge: 'Vibes', 'A again': 'Vibes' },
  'room-service': { Verse: 'Lead', Hook: 'Lead' },
  turndown: { Drop: 'Loop', 'Drop 2': 'Riff' },
  'ice-machine': { Riddim: 'Melodica', Outro: 'Melodica' },
  'service-lift': { Break: 'Lead' },
  'boiler-room': { Chorus: 'Lead' },
  vacancy: { Verse: 'Neon', Chorus: 'Topline', 'Verse 2': 'Neon', 'Chorus 2': 'Topline', Bridge: 'Topline', 'Chorus 3': 'Topline', Outro: 'Neon' },
};
