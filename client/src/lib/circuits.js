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

// OpenF1 numbers circuits (circuit_key) the way F1 live timing and MultiViewer
// do; Jolpica doesn't. Match a calendar race to its OpenF1 sessions by date.
export const circuitKeyFor = (race, openf1Sessions) => {
  if (!race || !openf1Sessions?.length) return null;
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
