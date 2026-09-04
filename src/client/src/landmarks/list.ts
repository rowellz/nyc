/**
 * BINs (NYC Building Identification Numbers) of buildings the landmarks module replaces with hand-built models.
 * The buildings module skips extruding these footprints. Keep this list static and cheap to import.
 */
export const LANDMARK_BINS: Set<number> = new Set<number>([
  1015862, // Empire State Building (350 5th Ave)
  1036156, // Chrysler Building (405 Lexington Ave)
  1016278, // Flatiron Building (175 5th Ave)
  1022581, // One Times Square (the wrapped-screen tower at 42nd/Broadway)
  1024706, // Paramount Building (1501 Broadway; the setback clock tower with the globe, west side at 43rd-44th)
  1085637, // TKTS booth, Duffy Square (the 4.9 m "TKTS" footprint on the bowtie axis at 47th; red glass steps)
  1034194, // New York Public Library, Stephen A. Schwarzman Building (5th Ave, 40th-42nd)
  1035381, // Grand Central Terminal (the terminal building on 42nd St; the viaduct wraps it)
  1090581, // One World Trade Center (285 Fulton St)
  1086977, // One World Trade Center podium / alternate BIN (skipped in case the rebuild uses it)
  1090825, // One Vanderbilt (42nd-43rd, Vanderbilt-Madison)
  1088817, // 432 Park Avenue (the lot)
  1035787, // 432 Park Avenue (the west strip of the same lot, also tagged 425 m)
  1036474, // Citigroup Center (601 Lexington)
  1087268, // Bank of America Tower (One Bryant Park)
  1087186, // The New York Times Building (620 8th Ave)
  1085630, // MetLife Building (200 Park; the tiles only carry its 48 m base)
  1036185, // Helmsley Building (230 Park)
  1083875, // United Nations Secretariat
  1088961, // 30 Hudson Yards + the Shops podium (one footprint in the tiles)
  1091590, // 35 Hudson Yards
  1089323, // 10 Hudson Yards (tagged 45 m in the tiles; 268 m built)
  1089412, // 55 Hudson Yards (tagged 24 m in the tiles; 237 m built)
  1091075, // Bryant Park: Josephine Shaw Lowell Memorial Fountain (a 3 m OSM disc at the 6th Ave end)
  1091074, // Bryant Park: SW food kiosk on the 6th Ave terrace ("LOR Porch")
  1091076, // Bryant Park: NW food kiosk on the 6th Ave terrace
  1090173, // Bryant Park: Le Carrousel (40th St side)
  1090169, // Bryant Park: cafe pavilion on the library's rear terrace (south)
  1090168, // Bryant Park: cafe pavilion on the library's rear terrace (north)
]);
