/**
 * The client's named camera spots, lifted verbatim from the recovered
 * src/client/src/core/spots.ts. `?spot=<id>` flies the camera to one of these
 * and skips the entry form, which is what /spots links to.
 *
 * heading: compass degrees the camera looks toward. pitch: degrees, negative =
 * down. h: metres above the street datum.
 */
export const SPOTS = [
  { id: 'bryant-park', name: 'Bryant Park (safe zone), looking east to the NYPL', lat: 40.7535181, lon: -73.9839881, heading: 75, pitch: 2, h: 1.7 },
  { id: 'times-square', name: 'Times Square, 7th Ave & 44th looking north', lat: 40.7572384, lon: -73.9862086, heading: 28.3, pitch: 6, h: 1.7 },
  { id: 'times-square-duffy', name: 'Duffy Square looking south to One Times Square', lat: 40.758965, lon: -73.984939, heading: 204, pitch: 7, h: 1.7 },
  { id: 'times-square-south', name: 'Times Square, Broadway & 47th looking south', lat: 40.75920, lon: -73.98500, heading: 200, pitch: 4, h: 1.7 },
  { id: 'fifth-42nd', name: '5th Ave at 41st looking northeast past the NYPL toward 42nd', lat: 40.7527180, lon: -73.9815891, heading: 29, pitch: 3, h: 1.7 },
  { id: 'park-ave-viaduct', name: 'Park Ave looking south to Grand Central / MetLife', lat: 40.7562698, lon: -73.9744091, heading: 209, pitch: 4, h: 1.7 },
  { id: 'empire-state', name: '5th Ave & 33rd looking at the Empire State Building', lat: 40.7475912, lon: -73.9850463, heading: 350, pitch: 22, h: 1.7 },
  { id: 'flatiron', name: 'Flatiron from 5th Ave & 24th looking south', lat: 40.7424909, lon: -73.9890529, heading: 208.4, pitch: 8, h: 1.7 },
  { id: 'soho', name: 'Greene St & Prince St, SoHo cast iron', lat: 40.7251742, lon: -73.9992890, heading: 212.8, pitch: 3, h: 1.7 },
  { id: 'west-village', name: 'Bleecker & Charles, West Village, looking north along Bleecker', lat: 40.7345044, lon: -74.0046305, heading: 347.6, pitch: 2, h: 1.7 },
  { id: 'wall-street', name: 'Broad St looking north to Wall St and the NYSE', lat: 40.7065475, lon: -74.0109096, heading: 355, pitch: 6, h: 1.7 },
  { id: 'brooklyn-bridge', name: 'Brooklyn Bridge walkway looking to Manhattan', lat: 40.70560, lon: -73.99630, heading: 300, pitch: 4, h: 7 },
  { id: 'columbus-circle', name: 'Columbus Circle looking south down Broadway', lat: 40.76810, lon: -73.98190, heading: 205, pitch: 4, h: 1.7 },
  { id: 'central-park-south', name: 'Central Park South at 6th Ave', lat: 40.76545, lon: -73.97600, heading: 299, pitch: 3, h: 1.7 },
  { id: 'chinatown', name: 'Canal St & Mott St, Chinatown', lat: 40.7166544, lon: -73.9976398, heading: 295.3, pitch: 2, h: 1.7 },
  { id: 'harlem', name: '125th St & Lenox Ave, Harlem', lat: 40.8077994, lon: -73.9452685, heading: 298.9, pitch: 2, h: 1.7 },
  { id: 'east-village', name: 'St. Marks Place & 2nd Ave', lat: 40.7286327, lon: -73.9878883, heading: 118.9, pitch: 2, h: 1.7 },
  { id: 'hudson-yards', name: 'Hudson Yards from 10th Ave & 33rd', lat: 40.7539041, lon: -73.9994011, heading: 299, pitch: 25, h: 1.7 },
  { id: 'union-square', name: 'Union Square looking north', lat: 40.7359214, lon: -73.9906529, heading: 20, pitch: 4, h: 1.7 },
  { id: 'park-ave-60', name: 'Park Ave at 60th looking south', lat: 40.7635941, lon: -73.9693181, heading: 208.1, pitch: 5, h: 1.7 },
  { id: 'rockefeller', name: 'Rockefeller Center from 5th Ave & 50th', lat: 40.75870, lon: -73.97740, heading: 299, pitch: 15, h: 1.7 },
  { id: 'tribeca', name: 'Greenwich St & Franklin, Tribeca', lat: 40.7196149, lon: -74.0102999, heading: 187.6, pitch: 3, h: 1.7 },
  { id: 'lower-east-side', name: 'Orchard & Rivington, LES', lat: 40.7204769, lon: -73.9890967, heading: 201.5, pitch: 3, h: 1.7 },
  { id: 'upper-west', name: 'Amsterdam Ave & 79th, Upper West Side', lat: 40.7829622, lon: -73.9783154, heading: 28.6, pitch: 3, h: 1.7 },
  { id: 'fdr', name: 'FDR Drive looking north at 34th', lat: 40.7433285, lon: -73.9721087, heading: 25.4, pitch: 2, h: 1.7 },
  { id: 'cross-bronx', name: 'Cross Bronx Expressway at the Alexander Hamilton Bridge, looking east into the Bronx', lat: 40.8450068, lon: -73.9265363, heading: 105, pitch: -2, h: 14.7 },
  { id: 'skyline-hudson', name: 'Midtown skyline from 400 m offshore in the Hudson', lat: 40.7516307, lon: -74.0135723, heading: 80, pitch: 6, h: 10.4 },
  { id: 'skyline-east', name: 'Midtown skyline from the East River', lat: 40.74600, lon: -73.95900, heading: 260, pitch: 8, h: 3 },
  { id: 'aerial-midtown', name: 'Aerial over Midtown looking south', lat: 40.76500, lon: -73.98000, heading: 195, pitch: -35, h: 260 },
  { id: 'aerial-downtown', name: 'Aerial over Lower Manhattan', lat: 40.72000, lon: -74.00500, heading: 190, pitch: -30, h: 300 },
];

export const spotById = (id) => SPOTS.find((s) => s.id === id);
