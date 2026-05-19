const CURATED_SONGS = [
  // Contemporary / Pop
  { title: "Thinking Out Loud", artist: "Ed Sheeran", bpm: 79, genre: "contemporary", energy: "low", videoId: "lp-EO5I60KA" },
  { title: "Stay With Me", artist: "Sam Smith", bpm: 84, genre: "contemporary", energy: "low", videoId: "pB-5XG-DbAA" },
  { title: "Watermelon Sugar", artist: "Harry Styles", bpm: 95, genre: "contemporary", energy: "medium", videoId: "E07s5ZYygMg" },
  { title: "Levitating", artist: "Dua Lipa", bpm: 103, genre: "pop", energy: "medium", videoId: "TUVcZfQe-Kw" },
  { title: "Can't Stop the Feeling", artist: "Justin Timberlake", bpm: 113, genre: "pop", energy: "high", videoId: "ru0K8uYEZWw" },
  { title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", bpm: 115, genre: "pop", energy: "high", videoId: "OPf0YbXqDm0" },
  { title: "Blinding Lights", artist: "The Weeknd", bpm: 171, genre: "pop", energy: "high", videoId: "4NRXx6U8ABQ" },
  { title: "As It Was", artist: "Harry Styles", bpm: 124, genre: "pop", energy: "medium", videoId: "H5v3kku4y6Q" },

  // R&B / Soul
  { title: "Signed Sealed Delivered", artist: "Stevie Wonder", bpm: 97, genre: "rnb", energy: "high", videoId: "kgT9QJ2htMc" },
  { title: "Superstition", artist: "Stevie Wonder", bpm: 98, genre: "rnb", energy: "high", videoId: "7_tmeHCO1IM" },
  { title: "Use Somebody", artist: "Kings of Leon", bpm: 136, genre: "contemporary", energy: "medium", videoId: "gnhXHvRoUd0" },
  { title: "Adorn", artist: "Miguel", bpm: 86, genre: "rnb", energy: "low", videoId: "8dM5QYdTo08" },
  { title: "Versace on the Floor", artist: "Bruno Mars", bpm: 60, genre: "rnb", energy: "low", videoId: "-FyjEnoIgTM" },
  { title: "That's What I Like", artist: "Bruno Mars", bpm: 124, genre: "rnb", energy: "high", videoId: "_p-8ZHg7II4" },
  { title: "Leave the Door Open", artist: "Silk Sonic", bpm: 90, genre: "rnb", energy: "medium", videoId: "adLGHcj_fmA" },
  { title: "Make Me Feel", artist: "Janelle Monáe", bpm: 108, genre: "rnb", energy: "high", videoId: "tGRzz0oqgUE" },

  // Blues
  { title: "At Last", artist: "Etta James", bpm: 67, genre: "blues", energy: "low", videoId: "1qJU8G7gR_g" },
  { title: "I Can't Make You Love Me", artist: "Bonnie Raitt", bpm: 60, genre: "blues", energy: "low", videoId: "nW9Cu6GYqxo" },
  { title: "The Thrill Is Gone", artist: "B.B. King", bpm: 72, genre: "blues", energy: "low", videoId: "SgXSomPE_FY" },
  { title: "Pride and Joy", artist: "Stevie Ray Vaughan", bpm: 130, genre: "blues", energy: "high", videoId: "I3MTGhRC82s" },

  // Neo-Soul
  { title: "Location", artist: "Khalid", bpm: 93, genre: "neo-soul", energy: "low", videoId: "by3yRdlQvzs" },
  { title: "Golden", artist: "Jill Scott", bpm: 98, genre: "neo-soul", energy: "medium", videoId: "4QCXr79Rkcw" },
  { title: "On & On", artist: "Erykah Badu", bpm: 77, genre: "neo-soul", energy: "low", videoId: "-CPCs7vVz6s" },
  { title: "Best Part", artist: "Daniel Caesar ft. H.E.R.", bpm: 87, genre: "neo-soul", energy: "low", videoId: "hKgl5-lkT8U" },
  { title: "Come Through and Chill", artist: "Miguel ft. J. Cole", bpm: 74, genre: "neo-soul", energy: "low", videoId: "u_C4onVrr8U" },

  // Country / Americana
  { title: "Tennessee Whiskey", artist: "Chris Stapleton", bpm: 77, genre: "country", energy: "low", videoId: "4zAThXFOy2c" },
  { title: "Fast Car", artist: "Tracy Chapman", bpm: 104, genre: "country", energy: "medium", videoId: "AIOAlaACuv4" },
  { title: "Jolene", artist: "Dolly Parton", bpm: 130, genre: "country", energy: "high", videoId: "5m71Jbi7NkU" },
  { title: "Take Me to Church", artist: "Hozier", bpm: 129, genre: "country", energy: "medium", videoId: "PVjiKRfKpPI" },

  // Funk
  { title: "September", artist: "Earth, Wind & Fire", bpm: 126, genre: "funk", energy: "high", videoId: "Gs069dndIYk" },
  { title: "Let's Groove", artist: "Earth, Wind & Fire", bpm: 104, genre: "funk", energy: "medium", videoId: "Lrle0x_DHBM" },
  { title: "Le Freak", artist: "Chic", bpm: 120, genre: "funk", energy: "high", videoId: "aXgSHL7efKg" },
  { title: "Got To Give It Up", artist: "Marvin Gaye", bpm: 109, genre: "funk", energy: "medium", videoId: "qhFNY9zW2F4" },

  // Jazz / Standards
  { title: "Fly Me to the Moon", artist: "Frank Sinatra", bpm: 88, genre: "jazz", energy: "low", videoId: "JYuyWrkwpok" },

  // Motown
  { title: "What's Going On", artist: "Marvin Gaye", bpm: 95, genre: "motown", energy: "medium", videoId: "o5TmORitlKk" },
  { title: "I Heard It Through the Grapevine", artist: "Marvin Gaye", bpm: 116, genre: "motown", energy: "medium", videoId: "IyKZtN33Wxs" },

  // Indie / Folk
  { title: "Budapest", artist: "George Ezra", bpm: 102, genre: "indie", energy: "medium", videoId: "VHrLPs3_1Fs" },
  { title: "Ho Hey", artist: "The Lumineers", bpm: 82, genre: "indie", energy: "low", videoId: "zvCBSSwgtg4" },
];

const GENRES = [
  { id: "all",          label: "All Genres" },
  { id: "blues",        label: "Blues" },
  { id: "rnb",          label: "R&B / Soul" },
  { id: "neo-soul",     label: "Neo-Soul" },
  { id: "funk",         label: "Funk" },
  { id: "motown",       label: "Motown" },
  { id: "jazz",         label: "Jazz / Standards" },
  { id: "contemporary", label: "Contemporary" },
  { id: "pop",          label: "Pop" },
  { id: "country",      label: "Country" },
  { id: "indie",        label: "Indie / Folk" },
];
