// Wikimedia circuit layouts, the fallback when the live outline isn't available.
// Keys cover both Sportstimes slugs and Ergast/Jolpica circuitIds.
export const CIRCUIT_IMAGES = {
  // 2026 Sportstimes Slugs
  "australian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/0/0a/Albert_Park_Circuit_2021.svg",
  "chinese-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/1/14/Shanghai_International_Racing_Circuit_track_map.svg",
  "japanese-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/e/ec/Suzuka_circuit_map--2005.svg",
  "bahrain-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Bahrain_International_Circuit--Grand_Prix_Layout.svg/640px-Bahrain_International_Circuit--Grand_Prix_Layout.svg.png",
  "saudi-arabia-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/4/4c/Jeddah_Street_Circuit_2021.svg",
  "miami-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/b/be/2022_F1_CourseLayout_Miami.svg",
  "canadian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/2/21/Circuit_Gilles_Villeneuve.svg",
  "monaco-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/5/56/Circuit_Monaco.svg",
  "barcelona-catalunya-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "austrian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/3/36/Red_Bull_Ring_moto_2022.svg",
  "british-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Silverstone_race_circuit.svg",
  "belgian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/5/54/Spa-Francorchamps_of_Belgium.svg",
  "hungarian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/9/91/Hungaroring.svg",
  "dutch-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/4/4a/Zandvoort.svg",
  "italian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/f/f8/Monza_track_map.svg",
  "spanish-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "azerbaijan-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Baku_Formula_One_circuit_map.svg",
  "singapore-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/8/8b/Marina_Bay_circuit_2023.svg",
  "us-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Austin_circuit.svg",
  "mexican-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/3/36/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez_2015.svg",
  "brazilian-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/5/5c/Circuit_Interlagos.svg",
  "las-vegas-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/4/43/2023_Las_Vegas_street_circuit.svg",
  "qatar-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/c/c7/Lusail_International_Circuit_2023.svg",
  "abu-dhabi-grand-prix": "https://upload.wikimedia.org/wikipedia/commons/d/dc/Circuit_Yas-Island.svg",

  // Ergast/Jolpica API circuitIds (for direct API responses)
  "albert_park": "https://upload.wikimedia.org/wikipedia/commons/0/0a/Albert_Park_Circuit_2021.svg",
  "shanghai": "https://upload.wikimedia.org/wikipedia/commons/1/14/Shanghai_International_Racing_Circuit_track_map.svg",
  "suzuka": "https://upload.wikimedia.org/wikipedia/commons/e/ec/Suzuka_circuit_map--2005.svg",
  "bahrain": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Bahrain_International_Circuit--Grand_Prix_Layout.svg/640px-Bahrain_International_Circuit--Grand_Prix_Layout.svg.png",
  "jeddah": "https://upload.wikimedia.org/wikipedia/commons/4/4c/Jeddah_Street_Circuit_2021.svg",
  "miami": "https://upload.wikimedia.org/wikipedia/commons/b/be/2022_F1_CourseLayout_Miami.svg",
  "villeneuve": "https://upload.wikimedia.org/wikipedia/commons/2/21/Circuit_Gilles_Villeneuve.svg",
  "monaco": "https://upload.wikimedia.org/wikipedia/commons/5/56/Circuit_Monaco.svg",
  "catalunya": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "red_bull_ring": "https://upload.wikimedia.org/wikipedia/commons/3/36/Red_Bull_Ring_moto_2022.svg",
  "silverstone": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Silverstone_race_circuit.svg",
  "spa": "https://upload.wikimedia.org/wikipedia/commons/5/54/Spa-Francorchamps_of_Belgium.svg",
  "hungaroring": "https://upload.wikimedia.org/wikipedia/commons/9/91/Hungaroring.svg",
  "zandvoort": "https://upload.wikimedia.org/wikipedia/commons/4/4a/Zandvoort.svg",
  "monza": "https://upload.wikimedia.org/wikipedia/commons/f/f8/Monza_track_map.svg",
  "madring": "https://upload.wikimedia.org/wikipedia/commons/2/26/Formula1_Circuit_Catalunya_2021.svg",
  "baku": "https://upload.wikimedia.org/wikipedia/commons/f/f1/Baku_Formula_One_circuit_map.svg",
  "marina_bay": "https://upload.wikimedia.org/wikipedia/commons/8/8b/Marina_Bay_circuit_2023.svg",
  "americas": "https://upload.wikimedia.org/wikipedia/commons/a/a5/Austin_circuit.svg",
  "rodriguez": "https://upload.wikimedia.org/wikipedia/commons/3/36/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez_2015.svg",
  "interlagos": "https://upload.wikimedia.org/wikipedia/commons/5/5c/Circuit_Interlagos.svg",
  "vegas": "https://upload.wikimedia.org/wikipedia/commons/4/43/2023_Las_Vegas_street_circuit.svg",
  "losail": "https://upload.wikimedia.org/wikipedia/commons/c/c7/Lusail_International_Circuit_2023.svg",
  "yas_marina": "https://upload.wikimedia.org/wikipedia/commons/d/dc/Circuit_Yas-Island.svg"
};

export const circuitImage = (circuitId) => {
  if (!circuitId) return null;
  const id = circuitId.toLowerCase();
  return CIRCUIT_IMAGES[id] || CIRCUIT_IMAGES[id.replace(/[-\s]/g, '_')] || CIRCUIT_IMAGES[id.replace(/_/g, '-')] || null;
};

// F1's own circuit numbers (live timing, MultiViewer and OpenF1 all use them).
// They never change for a venue, so a fixed table is the reliable way to find
// a race's outline; OpenF1's session list is only the fallback for a venue
// that isn't listed here yet.
const CIRCUIT_KEYS = {
  albert_park: 10, shanghai: 49, suzuka: 46, bahrain: 63, jeddah: 149, miami: 151,
  villeneuve: 23, monaco: 22, catalunya: 15, red_bull_ring: 19, silverstone: 2, spa: 7,
  hungaroring: 4, zandvoort: 55, monza: 39, madring: 153, baku: 144, sepang: 12,
  marina_bay: 61, americas: 9, rodriguez: 65, interlagos: 14, vegas: 152, losail: 150,
  yas_marina: 70,
};
// Sportstimes calendar slugs (the fallback calendar) for the same venues
const SLUG_KEYS = {
  'australian-grand-prix': 10, 'chinese-grand-prix': 49, 'japanese-grand-prix': 46, 'bahrain-grand-prix': 63,
  'saudi-arabia-grand-prix': 149, 'miami-grand-prix': 151, 'canadian-grand-prix': 23, 'monaco-grand-prix': 22,
  'barcelona-catalunya-grand-prix': 15, 'austrian-grand-prix': 19, 'british-grand-prix': 2, 'belgian-grand-prix': 7,
  'hungarian-grand-prix': 4, 'dutch-grand-prix': 55, 'italian-grand-prix': 39, 'spanish-grand-prix': 153,
  'azerbaijan-grand-prix': 144, 'singapore-grand-prix': 61, 'us-grand-prix': 9, 'mexican-grand-prix': 65,
  'brazilian-grand-prix': 14, 'las-vegas-grand-prix': 152, 'qatar-grand-prix': 150, 'abu-dhabi-grand-prix': 70,
};

export const circuitKeyFor = (race, openf1Sessions) => {
  if (!race) return null;
  const id = race.Circuit?.circuitId;
  const known = CIRCUIT_KEYS[id] || SLUG_KEYS[id];
  if (known) return known;
  if (!openf1Sessions?.length) return null;
  const raceDay = new Date(`${race.date}T${race.time || '12:00:00Z'}`).getTime();
  const match = openf1Sessions.find(s => Math.abs(new Date(s.date_start).getTime() - raceDay) < 4 * 864e5);
  return match?.circuit_key ?? null;
};

// Team colours by Jolpica constructorId (approximate 2026 liveries)
const TEAM_COLOURS = {
  mclaren: '#FF8000', ferrari: '#E8002D', mercedes: '#27F4D2', red_bull: '#3671C6',
  aston_martin: '#229971', alpine: '#00A1E8', williams: '#1868DB', rb: '#6C98FF',
  sauber: '#52E252', audi: '#BB0A30', haas: '#B6BABD', cadillac: '#C9A86A',
};
export const teamColour = (constructorId) => TEAM_COLOURS[constructorId] || '#8C9AAF';
