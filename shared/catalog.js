/* =====================================================================
   THE SETTLEMENT · developer guide
   ---------------------------------------------------------------------
   ADD A STRUCTURE: add one entry to BUILDING_TYPES.
     cat     which build menu it appears in (see CATS)
     size    [w,d] footprint in tiles
     style   a drawer in DRAW (house, block, factory, dome, silo, ...)
     colors  wall / roof / trim (+ optional extras the style reads)
     home:{capacity,rent} · work:{title,slots,salary} · leisure:true, visitors:N · outdoor:true
     cost    coins taken from the town treasury when placed
     Style options: house → timber, chimney, awning
                    block → mansard, glass, awning, sign+label, neon, garage, cross, bars, balcony
   ADD A ROAD: add an entry to ROAD_TYPES (kind: street | highway | cobble | dirt | rail | crossing; lanes: one1 | one2 | four | median; walk: sidewalk width).
   RAIL: kind 'rail' tiles join up into lines and trains run on them by themselves; 'platform' tiles are stations
         (trains stop there), and a 'crossing' is a street that a railway crosses (cars and trains both use it).
   sub      the tab inside a build menu (see SUBS)
   This file is shared: the server validates builds with it, the browser draws with it.
   TIME: 30 real minutes = 1 game day. The world is a pure function of the clock.
   ===================================================================== */

// Every kind of bank: any of them takes deposits and pays out withdrawals (one account per colonist, shared by all).
export const BANK_TYPES = ['microbank', 'communitybank', 'bank', 'intlbank'];
export const isBank = type => BANK_TYPES.includes(type);

export const ROAD_TYPES = {
  street:     { name:'Street', note:'two-way', sub:'streets', kind:'street', top:'#7E8185', walk:'#DCD8CE', cost:30, speed:2.0 },
  curvestreet:{ name:'Curved street', note:'rounds its corners', sub:'streets', kind:'street', curve:true, top:'#7E8185', walk:'#DCD8CE', cost:35, speed:2.0 },
  roundabout: { name:'Roundabout', note:'lay 3×3 for a big one', sub:'streets', kind:'street', round:true, top:'#7E8185', walk:'#DCD8CE', cost:45, speed:1.8 },
  culdesac:   { name:'Cul-de-sac', note:'turning circle at the end', sub:'streets', kind:'street', bulb:true, top:'#7E8185', walk:'#DCD8CE', cost:35, speed:1.8 },
  oneway1:    { name:'One-way street', note:'1 lane', sub:'streets', kind:'street', lanes:'one1', top:'#7E8185', walk:'#DCD8CE', cost:25, speed:2.1 },
  oneway2:    { name:'One-way, 2 lanes', note:'2 lanes', sub:'streets', kind:'street', lanes:'one2', top:'#7E8185', walk:'#DCD8CE', cost:35, speed:2.3 },
  boulevard:  { name:'Boulevard', note:'tree-lined median', sub:'streets', kind:'street', lanes:'median', top:'#7E8185', walk:'#DCD8CE', cost:70, speed:2.3 },
  pedestrian: { name:'Pedestrian lane', note:'car-free', sub:'streets', kind:'cobble', top:'#DCCDAE', edge:'#B5A27E', cost:20, speed:1.6, nocars:true },
  parking:    { name:'Street with parking', note:'cars at the curb', sub:'curbside', kind:'street', deco:'cars', top:'#7E8185', walk:'#DCD8CE', cost:40, speed:1.8 },
  trees:      { name:'Tree-lined street', note:'trees on the walks', sub:'curbside', kind:'street', deco:'trees', top:'#7E8185', walk:'#DCD8CE', cost:45, speed:2.0 },
  widewalk:   { name:'Wide sidewalk', note:'room to stroll', sub:'curbside', kind:'street', walk:'#E2D9C6', walkW:0.42, top:'#7E8185', cost:40, speed:2.0 },
  mainstreet: { name:'Main street', note:'wide walks, lamps', sub:'curbside', kind:'street', deco:'lamps', walk:'#E2D3BC', walkW:0.42, top:'#7E8185', cost:60, speed:1.9 },
  fourlane:   { name:'Four-lane road', note:'4 lanes', sub:'wide', kind:'street', lanes:'four', top:'#74777B', walk:'#D3CFC4', walkW:0.22, cost:90, speed:2.8 },
  avenue:     { name:'Avenue', note:'4 lanes, green median', sub:'wide', kind:'street', lanes:'median4', top:'#74777B', walk:'#D3CFC4', walkW:0.22, cost:120, speed:2.8 },
  highway:    { name:'Highway', note:'fast, no sidewalks', sub:'highway', kind:'highway', top:'#5F6266', cost:160, speed:4.0, walkCost:4 },
  cobble:     { name:'Cobblestone', note:'old town', sub:'surface', kind:'cobble', top:'#C4BDAE', edge:'#978F80', cost:15, speed:1.7 },
  plaza:      { name:'Brick plaza', note:'warm red brick', sub:'surface', kind:'cobble', top:'#C98A72', edge:'#A0654F', cost:20, speed:1.6, nocars:true },
  stone:      { name:'Stone paving', note:'large slabs', sub:'surface', kind:'cobble', top:'#D3D0C8', edge:'#A9A59B', cost:18, speed:1.6, nocars:true },
  grasspave:  { name:'Grass pavers', note:'green and porous', sub:'surface', kind:'cobble', top:'#A9C98A', edge:'#8AAE6B', cost:12, speed:1.5, nocars:true },
  sand:       { name:'Sand path', note:'beach and park', sub:'surface', kind:'dirt', top:'#E8D6A6', edge:'#C9B47E', cost:4, speed:1.3, nocars:true },
  gravel:     { name:'Gravel path', note:'cheap and quick', sub:'surface', kind:'dirt', top:'#CDC7B8', edge:'#A39C8C', cost:5, speed:1.4 },
  dirt:       { name:'Dirt path', note:'free', sub:'surface', kind:'dirt', top:'#D6BE8E', edge:'#B09466', cost:0, speed:1.4 },
  rail:       { name:'Railway', note:'trains run on it', sub:'rail', kind:'rail', top:'#A39A8C', edge:'#857C6E', cost:80, speed:1.2, nocars:true, walkCost:5 },
  platform:   { name:'Station platform', note:'trains stop here', sub:'rail', kind:'rail', platform:true, top:'#CFC9BC', edge:'#A39F95', cost:120, speed:1.2, nocars:true, walkCost:3 },
  railcross:  { name:'Level crossing', note:'where a road meets the rails', sub:'rail', kind:'crossing', top:'#7E8185', walk:'#DCD8CE', cost:100, speed:1.6 },
  asphalt:    { name:'Street', kind:'street', top:'#7E8185', walk:'#DCD8CE', cost:30, speed:2.0, hidden:true },
};

export const CATS = [
  { id:'roads',     name:'Roads' },
  { id:'terrain',   name:'Terrain' },
  { id:'utilities', name:'Utilities' },
  { id:'housing',   name:'Housing' },
  { id:'shops',     name:'Shops' },
  { id:'offices',   name:'Offices' },
  { id:'industry',  name:'Industry' },
  { id:'services',  name:'Services' },
  { id:'parks',     name:'Parks' },
  { id:'decor',     name:'Street' },
  { id:'landmarks', name:'Landmarks' },
  { id:'nature',    name:'Nature' },
  { id:'vehicles',  name:'Vehicles' },
  { id:'weather',   name:'Weather' },
  { id:'disasters', name:'Disasters' },
  { id:'bulldoze',  name:'Bulldoze' },
];

export const BUILDING_TYPES = {
  // ---------- housing
  tent:       { name:'Shelter tent', cat:'housing', size:[1,1], style:'tent', colors:{wall:'#EFE4C6', roof:'#C8623F'}, home:{capacity:2, rent:0}, cost:0 },
  cabin:      { name:'Log cabin', cat:'housing', size:[2,2], style:'house', height:22, roofH:18, colors:{wall:'#A0704A', roof:'#5C4A3B', trim:'#4E3420'}, chimney:true, home:{capacity:3, rent:4}, cost:400 },
  cottage:    { name:'Cottage', cat:'housing', size:[1,1], style:'house', height:18, roofH:16, colors:{wall:'#F2E6C9', roof:'#C9653F', trim:'#6E4F3A'}, chimney:true, home:{capacity:3, rent:3}, cost:500 },
  house:      { name:'House', cat:'housing', size:[2,2], style:'house', height:28, roofH:22, colors:{wall:'#EDE3CC', roof:'#C9653F', trim:'#6E4F3A'}, chimney:true, home:{capacity:4, rent:8}, cost:900 },
  timber:     { name:'Half-timbered house', cat:'housing', size:[2,2], style:'house', height:32, roofH:24, colors:{wall:'#F3EAD6', roof:'#A9483A', trim:'#5A3B22'}, timber:true, chimney:true, home:{capacity:5, rent:8}, cost:1300 },
  rowhouses:  { name:'Row houses', cat:'housing', size:[3,1], style:'house', height:26, roofH:14, colors:{wall:'#C7684F', roof:'#5E5A57', trim:'#3F2A22'}, chimney:true, home:{capacity:8, rent:9}, cost:1800 },
  brickflats: { name:'Brick flats', cat:'housing', size:[2,2], style:'block', height:64, colors:{wall:'#B5543E', roof:'#8C8783', trim:'#4A2E25'}, home:{capacity:8, rent:10}, cost:2400 },
  townhouse:  { name:'Mansard townhouse', cat:'housing', size:[2,2], style:'block', height:46, mansard:true, colors:{wall:'#E9DFC8', roof:'#5B6672', trim:'#6B5E4E'}, home:{capacity:12, rent:12}, cost:3600 },
  apartment:  { name:'Panel block', cat:'housing', size:[3,2], style:'block', height:80, colors:{wall:'#E3DCEA', roof:'#A3A19C', trim:'#5F574C', balcony:'#E6C35C', balcony2:'#9CC49A'}, home:{capacity:14, rent:12}, cost:4800 },
  aptower:    { name:'Apartment tower', cat:'housing', size:[2,2], style:'block', height:128, colors:{wall:'#D7D2C4', roof:'#8C8783', trim:'#4E4A44', balcony:'#9CC49A', balcony2:'#E6C35C'}, home:{capacity:30, rent:14}, cost:9500 },
  // ---------- shops
  stall:      { name:'Market stall', cat:'shops', size:[1,1], style:'stall', colors:{wall:'#B88A5A', roof:'#D9544A', roof2:'#F4EDE0'}, work:{title:'Merchant', slots:1, salary:16}, outdoor:true, cost:300 },
  bakery:     { name:'Bakery', cat:'shops', size:[2,2], style:'house', height:26, roofH:18, colors:{wall:'#F2DDB6', roof:'#5E8F4E', trim:'#8C5B33'}, awning:'#B5523B', chimney:true, work:{title:'Baker', slots:2, salary:24}, cost:1200 },
  cafe:       { name:'Café', cat:'shops', size:[1,1], style:'block', height:28, awning:'#2F7D63', colors:{wall:'#F1E3C2', roof:'#7C6A55', trim:'#2F7D63'}, work:{title:'Barista', slots:2, salary:18}, leisure:true, visitors:20, cost:1000 },
  bookshop:   { name:'Bookshop', cat:'shops', size:[1,1], style:'house', height:26, roofH:14, awning:'#2F4A7A', colors:{wall:'#B5543E', roof:'#5E5A57', trim:'#2F4A7A'}, work:{title:'Bookseller', slots:2, salary:19}, leisure:true, visitors:15, cost:1100 },
  grocer:     { name:'Grocer', cat:'shops', size:[2,1], style:'block', height:26, awning:'#D9544A', colors:{wall:'#E7D3B0', roof:'#8C7B66', trim:'#6E4F3A'}, work:{title:'Grocer', slots:3, salary:20}, cost:1500 },
  tavern:     { name:'Tavern', cat:'shops', size:[2,2], style:'house', height:26, roofH:20, colors:{wall:'#E3B878', roof:'#8A3A2E', trim:'#5E3A1E'}, chimney:true, work:{title:'Bartender', slots:2, salary:22}, leisure:true, visitors:40, cost:1600 },
  supermarket:{ name:'Supermarket', cat:'shops', size:[3,2], style:'block', height:22, sign:'#D9544A', label:'MARKET', colors:{wall:'#ECE7DD', roof:'#9C9A95', trim:'#D9544A'}, work:{title:'Cashier', slots:8, salary:20}, cost:4200 },
  deptstore:  { name:'Department store', cat:'shops', size:[3,3], style:'block', height:50, mansard:true, awning:'#7A2E2E', colors:{wall:'#EDE3CC', roof:'#4F5B66', trim:'#7A2E2E'}, work:{title:'Shop assistant', slots:20, salary:24}, leisure:true, visitors:150, cost:9000 },
  casino:     { name:'Casino', cat:'shops', size:[3,3], style:'block', height:36, sign:'#2E1A28', label:'CASINO', neon:true, colors:{wall:'#6B2A4A', roof:'#2E1A28', trim:'#F2B33D'}, work:{title:'Dealer', slots:6, salary:34}, leisure:true, visitors:200, cost:12000 },
  // ---------- offices
  office:     { name:'Small office', cat:'offices', size:[1,1], style:'block', height:46, colors:{wall:'#E3DED2', roof:'#7E7B78', trim:'#3F4A52'}, work:{title:'Clerk', slots:6, salary:28}, cost:2200 },
  brickoffice:{ name:'Brick office', cat:'offices', size:[2,2], style:'block', height:62, colors:{wall:'#A9573F', roof:'#6E6A66', trim:'#3B2A22'}, work:{title:'Analyst', slots:14, salary:32}, cost:4800 },
  glassoffice:{ name:'Glass office', cat:'offices', size:[2,2], style:'block', height:96, glass:true, colors:{wall:'#8FB3C4', roof:'#5D6F78', trim:'#2F3E46'}, work:{title:'Engineer', slots:30, salary:40}, cost:8500 },
  biztower:   { name:'Business tower', cat:'offices', size:[2,2], style:'block', height:164, glass:true, colors:{wall:'#9BB7C2', roof:'#4E5D66', trim:'#2B363C'}, work:{title:'Manager', slots:60, salary:48}, cost:16000 },
  // ---------- industry
  farm:       { name:'Farm field', cat:'industry', size:[3,2], style:'farm', colors:{soil:'#9A7A50', crop:'#DCC75C'}, work:{title:'Farmer', slots:3, salary:18}, outdoor:true, cost:600 },
  lumber:     { name:'Lumber camp', cat:'industry', size:[2,2], style:'house', height:18, roofH:14, colors:{wall:'#A9794C', roof:'#5E8F4E', trim:'#5E4128'}, work:{title:'Lumberjack', slots:2, salary:20}, cost:800 },
  windmill:   { name:'Windmill', cat:'industry', size:[1,1], style:'windmill', colors:{wall:'#E9DFC8', roof:'#5E4637'}, work:{title:'Miller', slots:2, salary:18}, cost:1500 },
  silo:       { name:'Grain silos', cat:'industry', size:[2,1], style:'silo', colors:{wall:'#C9CCCB', roof:'#8E9396'}, work:{title:'Miller', slots:3, salary:18}, cost:1400 },
  workshop:   { name:'Workshop', cat:'industry', size:[2,2], style:'block', height:30, colors:{wall:'#BDB8AC', roof:'#6A6F75', trim:'#4B4F54'}, garage:true, work:{title:'Craftsperson', slots:3, salary:26}, cost:2000 },
  warehouse:  { name:'Warehouse', cat:'industry', size:[3,2], style:'factory', height:24, colors:{wall:'#B9B2A3', roof:'#6E7378'}, work:{title:'Stocker', slots:8, salary:20}, cost:2600 },
  factory:    { name:'Brick factory', cat:'industry', size:[3,3], style:'factory', height:30, saw:true, chimneys:2, colors:{wall:'#A6533D', roof:'#5E5A57'}, work:{title:'Machinist', slots:25, salary:30}, cost:6000 },
  // ---------- services
  townhall:   { name:'Town hall', cat:'services', size:[3,3], style:'house', height:40, roofH:26, colors:{wall:'#B5543E', roof:'#5E8F4E', trim:'#EDE3CC'}, work:{title:'Clerk', slots:4, salary:32}, cost:8000 },
  police:     { name:'Police station', cat:'services', size:[2,2], style:'block', height:32, sign:'#2F4A7A', label:'POLICE', colors:{wall:'#DCE3EA', roof:'#2F4A7A', trim:'#2F4A7A'}, work:{title:'Officer', slots:3, salary:30}, cost:3000 },
  jail:       { name:'Jail', cat:'services', size:[2,2], style:'block', height:28, bars:true, colors:{wall:'#9EA3A6', roof:'#5D6266', trim:'#2F3438'}, work:{title:'Guard', slots:3, salary:28}, cost:3500 },
  fire:       { name:'Fire station', cat:'services', size:[2,2], style:'block', height:30, garage:'#C8382E', colors:{wall:'#B5543E', roof:'#5E5A57', trim:'#C8382E'}, work:{title:'Firefighter', slots:4, salary:30}, cost:3200 },
  clinic:     { name:'Clinic', cat:'services', size:[2,2], style:'block', height:34, cross:true, colors:{wall:'#F2F0EA', roof:'#8FA3A8', trim:'#C8382E'}, work:{title:'Nurse', slots:6, salary:34}, cost:3800 },
  school:     { name:'School', cat:'services', size:[3,2], style:'house', height:30, roofH:20, colors:{wall:'#E3B878', roof:'#7A2E2E', trim:'#5E3A1E'}, work:{title:'Teacher', slots:6, salary:30}, cost:4500 },
  library:    { name:'Domed library', cat:'services', size:[2,2], style:'dome', height:30, colors:{wall:'#E9E3D3', roof:'#6E9A8C'}, work:{title:'Librarian', slots:3, salary:26}, leisure:true, visitors:80, cost:5000 },
  postoffice: { name:'Post office', cat:'services', size:[2,1], style:'block', height:30, sign:'#2F4A7A', label:'POST', colors:{wall:'#E7C25A', roof:'#5E5A57', trim:'#2F4A7A'}, work:{title:'Postie', slots:4, salary:24}, cost:2400 },
  // ---------- utilities
  watertower: { name:'Water tower', cat:'utilities', size:[1,1], style:'watertower', height:72, colors:{wall:'#C3C6C6'}, cost:1600 },
  pump:       { name:'Pump house', cat:'utilities', size:[1,1], style:'house', height:18, roofH:12, colors:{wall:'#C9B79A', roof:'#4C5A6B', trim:'#3F3A33'}, work:{title:'Engineer', slots:2, salary:24}, cost:1200 },
  turbine:    { name:'Wind turbine', cat:'utilities', size:[1,1], style:'turbine', cost:1800 },
  solar:      { name:'Solar field', cat:'utilities', size:[2,2], style:'solar', outdoor:true, cost:2600 },
  pylon:      { name:'Power pylon', cat:'utilities', size:[1,1], style:'pylon', cost:200 },
  // ---------- parks
  gym:        { name:'Gym', cat:'parks', size:[2,2], style:'block', height:30, sign:'#D9544A', label:'GYM', colors:{wall:'#3E4A5C', roof:'#2B3340', trim:'#D9544A'}, work:{title:'Trainer', slots:4, salary:24}, leisure:true, visitors:80, cost:3500 },
  fitpark:    { name:'Fitness park', cat:'parks', size:[2,2], style:'fitpark', colors:{grass:'#7DB656'}, leisure:true, visitors:40, outdoor:true, cost:900 },
  racetrack:  { name:'Racetrack', cat:'parks', size:[5,3], style:'racetrack', colors:{grass:'#7DB656', dirt:'#C9A06A', stand:'#B5523B'}, work:{title:'Creature keeper', slots:4, salary:26}, leisure:true, visitors:150, outdoor:true, cost:9000 },
  park:       { name:'Park', cat:'parks', size:[2,2], style:'park', colors:{grass:'#7DB656'}, leisure:true, visitors:60, outdoor:true, cost:700 },
  garden:     { name:'Flower garden', cat:'parks', size:[2,2], style:'garden', leisure:true, visitors:50, outdoor:true, cost:800 },
  playground: { name:'Playground', cat:'parks', size:[2,2], style:'playground', leisure:true, visitors:40, outdoor:true, cost:900 },
  square:     { name:'Town square', cat:'parks', size:[3,3], style:'square', leisure:true, visitors:120, outdoor:true, cost:1200 },
  fountain:   { name:'Fountain', cat:'parks', size:[2,2], style:'fountain', colors:{wall:'#CFC9BB'}, leisure:true, visitors:40, outdoor:true, cost:1500 },
  // ---------- street furniture
  lamp:       { name:'Street lamp', cat:'decor', size:[1,1], style:'lamp', outdoor:true, cost:50 },
  bench:      { name:'Bench', cat:'decor', size:[1,1], style:'bench', outdoor:true, leisure:true, visitors:4, cost:40 },
  busstop:    { name:'Bus stop', cat:'decor', size:[1,1], style:'busstop', outdoor:true, cost:150 },
  hedge:      { name:'Hedge', cat:'decor', size:[1,1], style:'hedge', outdoor:true, cost:20 },
  flowers:    { name:'Flower bed', cat:'decor', size:[1,1], style:'flowers', outdoor:true, cost:30 },
  // ---------- landmarks
  landing:    { name:'Landing station', note:'where colonists arrive from the ark', cat:'landmarks', size:[2,2], style:'starport', leisure:true, visitors:30, outdoor:true, cost:0, unique:true },
  campfire:   { name:'Campfire', cat:'landmarks', size:[1,1], style:'campfire', leisure:true, visitors:20, outdoor:true, cost:0 },
  well:       { name:'Well', cat:'landmarks', size:[1,1], style:'well', colors:{wall:'#B2B1A9', roof:'#8E5A3A'}, leisure:true, visitors:10, outdoor:true, cost:300 },
  statue:     { name:'Statue', cat:'landmarks', size:[1,1], style:'statue', colors:{wall:'#D2CEC2'}, leisure:true, visitors:15, outdoor:true, cost:2000 },
  obelisk:    { name:'Obelisk', cat:'landmarks', size:[1,1], style:'obelisk', colors:{wall:'#D8D0BE'}, cost:2500 },
  gate:       { name:'City gate', cat:'landmarks', size:[2,1], style:'gate', colors:{wall:'#CDBF9F', roof:'#A9483A'}, cost:5000 },
  clocktower: { name:'Clock tower', cat:'landmarks', size:[1,1], style:'tower', height:92, colors:{wall:'#B5543E', roof:'#4E7F48'}, cost:6000 },
  chapel:     { name:'Chapel', cat:'landmarks', size:[2,2], style:'dome', onion:true, height:34, colors:{wall:'#EFE8D8', roof:'#E2B13C'}, leisure:true, visitors:60, cost:7000 },
  lookout:    { name:'Lookout tower', cat:'landmarks', size:[2,2], style:'lattice', height:150, colors:{wall:'#4A4F52'}, leisure:true, visitors:100, outdoor:true, cost:12000 },
  // ---------- nature
  tree:       { name:'Oak tree', cat:'nature', size:[1,1], style:'tree', colors:{leaf:'#6FAE45'}, outdoor:true, cost:10 },
  pine:       { name:'Pine tree', cat:'nature', size:[1,1], style:'pine', colors:{leaf:'#3E7A4B'}, outdoor:true, cost:10 },
  birch:      { name:'Birch', cat:'nature', size:[1,1], style:'birch', colors:{leaf:'#9CCB5A'}, outdoor:true, cost:10 },
  bush:       { name:'Bushes', cat:'nature', size:[1,1], style:'bush', colors:{leaf:'#5E9E45'}, outdoor:true, cost:5 },
  rocks:      { name:'Rocks', cat:'nature', size:[1,1], style:'rocks', outdoor:true, cost:5 },

  // ======== added from the reference set (original designs) ========
  // ---------- housing
  gablecottage:{ name:'Gabled cottage', cat:'housing', size:[1,1], style:'gabled', gable:'plain', height:22, palette:['#C7684F'], roof:'#5E5A57', home:{capacity:4, rent:3}, cost:700 },
  chalet:     { name:'Mountain chalet', cat:'housing', size:[2,2], style:'house', height:22, roofH:14, colors:{wall:'#B98A5A', roof:'#5C4A3B', trim:'#4E3420'}, timber:true, chimney:true, home:{capacity:7, rent:5}, cost:1100 },
  villa:      { name:'Garden villa', cat:'housing', size:[2,2], style:'house', height:30, roofH:16, colors:{wall:'#F4EDE0', roof:'#8A3A2E', trim:'#6E4F3A'}, chimney:true, home:{capacity:6, rent:9}, cost:1600 },
  garagevilla:{ name:'Villas over garages', cat:'housing', size:[2,2], style:'block', height:34, garage:true, colors:{wall:'#E9E3D6', roof:'#7C8288', trim:'#3F4A52', balcony:'#9CC49A'}, home:{capacity:20, rent:9}, cost:2200 },
  townhouses: { name:'Row townhouses', cat:'housing', size:[3,1], style:'gabled', gable:'plain', height:34, palette:['#A9573F','#B5543E','#8C4A3A'], roof:'#4E4A44', home:{capacity:10, rent:9}, cost:1900 },
  canalhouses:{ name:'Canal houses', cat:'housing', size:[3,1], style:'gabled', gable:'step', height:42, palette:['#8C4A3A','#B5543E','#5E5A57','#C79A62'], roof:'#4E4A44', home:{capacity:10, rent:10}, cost:2000 },
  baroquegables:{ name:'Baroque gabled houses', cat:'housing', size:[3,1], style:'gabled', gable:'bell', height:38, palette:['#E8C66A','#E7D3B0','#C98A72','#9CC4B8'], roof:'#5E5A57', home:{capacity:22, rent:10}, cost:3200 },
  workers:    { name:'Workers’ terrace', cat:'housing', size:[4,1], style:'gabled', gable:'plain', height:24, palette:['#B5543E','#A9573F'], roof:'#5E5A57', home:{capacity:21, rent:6}, cost:2300 },
  walkup:     { name:'Brick walk-up', cat:'housing', size:[1,1], style:'block', height:58, fireEscape:true, colors:{wall:'#9C4A36', roof:'#6E6A66', trim:'#2F3438'}, home:{capacity:12, rent:10}, cost:1800 },
  mews:       { name:'Mews lane', cat:'housing', size:[3,1], style:'house', height:22, roofH:12, colors:{wall:'#EFE8D8', roof:'#5B6672', trim:'#3F4A52'}, home:{capacity:14, rent:8}, cost:2000 },
  almshouse:  { name:'Almshouse court', cat:'housing', size:[3,3], style:'house', height:20, roofH:14, colors:{wall:'#B5543E', roof:'#8A3A2E', trim:'#EFE8D8'}, chimney:true, home:{capacity:21, rent:5}, cost:2600 },
  terraces:   { name:'House with terraces', cat:'housing', size:[2,2], style:'block', height:50, colors:{wall:'#E3DED2', roof:'#7E7B78', trim:'#3F4A52', balcony:'#9CC49A', balcony2:'#E6C35C'}, home:{capacity:22, rent:10}, cost:2800 },
  slab50s:    { name:'Fifties slab', cat:'housing', size:[3,1], style:'block', height:60, colors:{wall:'#E7D3B0', roof:'#9C9A95', trim:'#6E4F3A', balcony:'#E6C35C'}, home:{capacity:25, rent:9}, cost:3000 },
  haussmann:  { name:'Parisian block', cat:'housing', size:[2,2], style:'block', height:62, mansard:true, colors:{wall:'#EDE3CC', roof:'#5B6672', trim:'#6B5E4E', balcony:'#4A4F52'}, home:{capacity:25, rent:14}, cost:3600 },
  georgian:   { name:'Georgian terrace', cat:'housing', size:[4,1], style:'block', height:44, colors:{wall:'#B5543E', roof:'#5E5A57', trim:'#F4EDE0'}, home:{capacity:30, rent:11}, cost:3800 },
  courtyard:  { name:'Courtyard block', cat:'housing', size:[3,3], style:'block', height:54, colors:{wall:'#D9C3A0', roof:'#8C7B66', trim:'#6E4F3A'}, home:{capacity:53, rent:11}, cost:5000 },
  arcadehouse:{ name:'Arcade house', cat:'housing', size:[2,2], style:'block', height:56, columns:true, colors:{wall:'#E8DCC2', roof:'#8C8783', trim:'#8A7F6A'}, home:{capacity:71, rent:12}, cost:6000 },
  artnouveau: { name:'Art nouveau house', cat:'housing', size:[2,2], style:'block', height:58, mansard:true, colors:{wall:'#D7E0D2', roof:'#5E7D6A', trim:'#6E4F3A', balcony:'#2F5D4A'}, home:{capacity:63, rent:14}, cost:6800 },
  gallery:    { name:'Gallery apartments', cat:'housing', size:[3,1], style:'block', height:70, colors:{wall:'#A9573F', roof:'#6E6A66', trim:'#2F3438', balcony:'#D9C3A0'}, home:{capacity:88, rent:12}, cost:7400 },
  altbau:     { name:'Courtyard apartment house', cat:'housing', size:[3,2], style:'block', height:66, mansard:true, colors:{wall:'#F2EAD9', roof:'#8A3A2E', trim:'#8A7F6A'}, home:{capacity:100, rent:13}, cost:8200 },
  pilotis:    { name:'Slab on stilts', cat:'housing', size:[3,1], style:'pilotis', height:92, lift:16, colors:{wall:'#8C8F94', roof:'#6E7378', trim:'#2F3438', balcony:'#C9CCCB'}, home:{capacity:121, rent:12}, cost:9800 },
  domedapt:   { name:'Domed apartments', cat:'housing', size:[2,2], style:'block', height:96, cupola:true, colors:{wall:'#B8A88E', roof:'#5E7D6A', trim:'#6E4F3A'}, home:{capacity:130, rent:14}, cost:10500 },
  cubetower:  { name:'Colorful cube tower', cat:'housing', size:[2,2], style:'stack', height:112, home:{capacity:130, rent:15}, cost:11000 },
  steppedtower:{ name:'Stepped tower with gardens', cat:'housing', size:[2,2], style:'stepped', height:130, colors:{wall:'#E3E0D8', roof:'#7DB656', trim:'#3F4A52'}, home:{capacity:122, rent:15}, cost:12000 },
  balconyblock:{ name:'Balcony block', cat:'housing', size:[3,2], style:'block', height:90, colors:{wall:'#EDE9E2', roof:'#9C9A95', trim:'#3F4A52', balcony:'#E6C35C', balcony2:'#D9714A'}, home:{capacity:233, rent:11}, cost:14000 },
  belletower: { name:'Belle époque tower', cat:'housing', size:[2,2], style:'block', height:150, mansard:true, colors:{wall:'#E8DCC2', roof:'#5B6672', trim:'#8A7F6A'}, home:{capacity:428, rent:16}, cost:18000 },
  // ---------- shops
  cornershop: { name:'Corner shop', cat:'shops', size:[1,1], style:'block', height:26, awning:'#3E7A4B', colors:{wall:'#EFE8D8', roof:'#8C7B66', trim:'#3E7A4B'}, work:{title:'Shopkeeper', slots:2, salary:16}, cost:700 },
  gamehouse:  { name:'Game House', cat:'shops', size:[3,2], style:'block', height:32, sign:'#1F3A6B', label:'GAMES', neon:true, awning:'#4FA3E0', colors:{wall:'#2F4F7F', roof:'#1C2C47', trim:'#F2C94C'}, work:{title:'Game host', slots:8, salary:26}, leisure:true, visitors:180, cost:9000 },
  cardealer:  { name:'Car dealership', cat:'shops', size:[3,2], style:'block', height:26, sign:'#2F4A7A', label:'CARS', awning:'#5B8DB8', colors:{wall:'#EEF1F4', roof:'#5E6E80', trim:'#2F4A7A'}, work:{title:'Car salesperson', slots:5, salary:24}, cost:6000 },
  petstore:   { name:'Pet store', cat:'shops', size:[2,1], style:'block', height:24, sign:'#2E8A73', label:'PETS', awning:'#3FBFA0', colors:{wall:'#F4EDE0', roof:'#5E7C99', trim:'#3FBFA0'}, work:{title:'Pet keeper', slots:3, salary:20}, leisure:true, visitors:20, cost:1600 },
  florist:    { name:'Florist', cat:'shops', size:[1,1], style:'house', height:22, roofH:12, awning:'#B06FD8', colors:{wall:'#F4EDE0', roof:'#5E8F4E', trim:'#6E4F3A'}, work:{title:'Florist', slots:2, salary:16}, cost:800 },
  pharmacy:   { name:'Pharmacy', cat:'shops', size:[1,1], style:'block', height:28, cross:true, colors:{wall:'#F2F0EA', roof:'#7E7B78', trim:'#3E7A4B'}, work:{title:'Pharmacist', slots:3, salary:22}, cost:1200 },
  diner:      { name:'Roadside diner', cat:'shops', size:[2,1], style:'block', height:20, sign:'#D9544A', label:'DINER', neon:true, colors:{wall:'#E8E6E0', roof:'#9C9A95', trim:'#D9544A'}, work:{title:'Cook', slots:6, salary:18}, leisure:true, visitors:40, cost:1500 },
  gasstation: { name:'Gas station', cat:'shops', size:[3,2], style:'gasstation', work:{title:'Attendant', slots:4, salary:18}, cost:2200 },
  restaurant: { name:'Restaurant', cat:'shops', size:[2,2], style:'house', height:28, roofH:16, awning:'#7A2E2E', colors:{wall:'#E3B878', roof:'#5E5A57', trim:'#5E3A1E'}, work:{title:'Waiter', slots:8, salary:20}, leisure:true, visitors:60, cost:2600 },
  markethall: { name:'Market hall', cat:'shops', size:[4,2], style:'market', colors:{wall:'#C99A62', roof:'#5E7D6A'}, work:{title:'Stallholder', slots:24, salary:18}, leisure:true, visitors:120, cost:4800 },
  openmarket: { name:'Open-air market', cat:'shops', size:[3,2], style:'stalls', work:{title:'Stallholder', slots:9, salary:15}, leisure:true, visitors:90, outdoor:true, cost:1800 },
  cinema:     { name:'Cinema', cat:'shops', size:[2,3], style:'block', height:40, sign:'#7A2E2E', label:'CINEMA', neon:true, colors:{wall:'#C99A62', roof:'#5E5A57', trim:'#7A2E2E'}, work:{title:'Usher', slots:10, salary:20}, leisure:true, visitors:150, cost:5200 },
  hotel:      { name:'Hotel', cat:'shops', size:[2,2], style:'block', height:70, sign:'#2F4A7A', label:'HOTEL', colors:{wall:'#E7D3B0', roof:'#8C7B66', trim:'#2F4A7A', balcony:'#2F4A7A'}, work:{title:'Receptionist', slots:20, salary:24}, cost:6500 },
  arcade:     { name:'Market arcade', cat:'shops', size:[3,2], style:'block', height:36, columns:true, colors:{wall:'#EFE4CC', roof:'#5E7D6A', trim:'#8A7F6A'}, work:{title:'Shop assistant', slots:50, salary:22}, leisure:true, visitors:120, cost:7000 },
  mall:       { name:'Shopping mall', cat:'shops', size:[4,4], style:'block', height:40, glass:true, sign:'#2F4A7A', label:'MALL', colors:{wall:'#9BB7C2', roof:'#8C8F94', trim:'#2B363C'}, work:{title:'Shop assistant', slots:120, salary:22}, leisure:true, visitors:300, cost:16000 },
  // ---------- offices
  studiooffice:{ name:'Studio office', cat:'offices', size:[1,1], style:'block', height:40, glass:true, colors:{wall:'#7FA0AE', roof:'#5D6F78', trim:'#2F3E46'}, work:{title:'Designer', slots:22, salary:30}, cost:3000 },
  bayoffice:  { name:'Bureau with bay windows', cat:'offices', size:[1,1], style:'block', height:62, bays:true, colors:{wall:'#D9C3A0', roof:'#5B6672', trim:'#6B5E4E'}, work:{title:'Clerk', slots:22, salary:30}, cost:3200 },
  belleoffice:{ name:'Belle époque office', cat:'offices', size:[2,2], style:'block', height:52, mansard:true, colors:{wall:'#EDE3CC', roof:'#5B6672', trim:'#8A7F6A'}, work:{title:'Secretary', slots:50, salary:32}, cost:5200 },
  slimtower:  { name:'Slim brick tower', cat:'offices', size:[1,1], style:'block', height:120, bands:true, colors:{wall:'#C7684F', roof:'#5E5A57', trim:'#EDE3CC'}, work:{title:'Broker', slots:88, salary:36}, cost:7500 },
  microbank:  { name:'Microfinance bank', cat:'offices', size:[1,1], style:'block', height:26, sign:'#2E8A73', label:'MFB', colors:{wall:'#EFE8D8', roof:'#7E7B78', trim:'#2E8A73'}, work:{title:'Loan officer', slots:3, salary:24}, cost:2500 },
  communitybank:{ name:'Community bank', cat:'offices', size:[2,1], style:'block', height:30, sign:'#6E2F22', label:'COMMUNITY', colors:{wall:'#B5674A', roof:'#5E5A57', trim:'#EDE3CC'}, work:{title:'Teller', slots:8, salary:28}, cost:4500 },
  bank:       { name:'Local bank', cat:'offices', size:[2,2], style:'block', height:46, columns:true, colors:{wall:'#E3DCC8', roof:'#8C8783', trim:'#8A7F6A'}, work:{title:'Banker', slots:24, salary:40}, cost:8200 },
  intlbank:   { name:'International bank', cat:'offices', size:[3,3], style:'block', height:150, glass:true, sign:'#1E2A44', label:'INTL BANK', colors:{wall:'#7FA3BE', roof:'#3B4A5C', trim:'#C9A44C'}, work:{title:'Investment banker', slots:40, salary:52}, cost:22000 },
  block70s:   { name:'Seventies office block', cat:'offices', size:[2,2], style:'block', height:70, ribbon:true, colors:{wall:'#B9B2A3', roof:'#5D6F78', trim:'#2F3E46'}, work:{title:'Accountant', slots:114, salary:34}, cost:9000 },
  kontor:     { name:'Brick trade house', cat:'offices', size:[2,2], style:'block', height:84, colors:{wall:'#7A3A2E', roof:'#4E4A44', trim:'#2B2621'}, work:{title:'Trader', slots:120, salary:34}, cost:9500 },
  wavytower:  { name:'Wavy glass tower', cat:'offices', size:[2,2], style:'twist', height:110, colors:{wall:'#9FB6BE', roof:'#5D6F78'}, work:{title:'Architect', slots:132, salary:38}, cost:10500 },
  exchange:   { name:'Clock tower exchange', cat:'offices', size:[2,2], style:'block', height:54, clock:true, colors:{wall:'#B5543E', roof:'#5E5A57', trim:'#EDE3CC'}, work:{title:'Trader', slots:132, salary:38}, cost:10500 },
  waterfront: { name:'Waterfront office', cat:'offices', size:[3,2], style:'block', height:60, glass:true, colors:{wall:'#7F9EAD', roof:'#3F4A52', trim:'#2B363C'}, work:{title:'Consultant', slots:132, salary:38}, cost:11000 },
  hightech:   { name:'High-tech office', cat:'offices', size:[2,2], style:'block', height:140, glass:true, exo:true, colors:{wall:'#5E6F78', roof:'#2F3438', trim:'#2B2621'}, work:{title:'Engineer', slots:216, salary:44}, cost:14000 },
  // ---------- industry
  garage:     { name:'Auto repair garage', cat:'industry', size:[2,1], style:'block', height:24, garage:'#D9544A', sign:'#D9544A', label:'GARAGE', colors:{wall:'#E7D3B0', roof:'#7C8288', trim:'#5E5A57'}, work:{title:'Mechanic', slots:18, salary:22}, cost:1800 },
  canalwarehouses:{ name:'Canal warehouses', cat:'industry', size:[3,1], style:'gabled', gable:'step', height:46, palette:['#8C4A3A','#7A3A2E','#9C5A44'], roof:'#4E4A44', hoist:true, work:{title:'Stocker', slots:20, salary:20}, cost:2400 },
  printshop:  { name:'Print shop', cat:'industry', size:[2,2], style:'factory', height:26, chimneys:1, colors:{wall:'#B5543E', roof:'#5E5A57'}, work:{title:'Printer', slots:18, salary:24}, cost:2600 },
  lumberyard: { name:'Building supply yard', cat:'industry', size:[3,2], style:'yard', colors:{wall:'#C9B79A', roof:'#5E8F4E'}, work:{title:'Yard hand', slots:27, salary:22}, cost:3000 },
  chemplant:  { name:'Chemical plant', cat:'industry', size:[3,3], style:'tanks', work:{title:'Chemist', slots:40, salary:32}, cost:6000 },
  brickworks: { name:'Brick works', cat:'industry', size:[3,2], style:'factory', height:28, saw:true, chimneys:2, colors:{wall:'#B5543E', roof:'#5E5A57'}, work:{title:'Brickmaker', slots:59, salary:28}, cost:6500 },
  chocolate:  { name:'Chocolate factory', cat:'industry', size:[3,3], style:'factory', height:32, saw:true, chimneys:1, colors:{wall:'#7A4A32', roof:'#C99A62'}, work:{title:'Chocolatier', slots:72, salary:30}, cost:8000 },
  winery:     { name:'Château winery', cat:'industry', size:[4,3], style:'winery', work:{title:'Vintner', slots:90, salary:28}, cost:9000 },
  gasworks:   { name:'Gasworks', cat:'industry', size:[3,3], style:'gasholder', work:{title:'Gas fitter', slots:90, salary:30}, cost:9500 },
  porcelain:  { name:'Porcelain works', cat:'industry', size:[3,2], style:'kilns', work:{title:'Potter', slots:99, salary:30}, cost:10500 },
  tireplant:  { name:'Tire plant', cat:'industry', size:[4,3], style:'factory', height:34, saw:true, chimneys:1, colors:{wall:'#9EA3A6', roof:'#4E4F52'}, work:{title:'Machinist', slots:134, salary:32}, cost:13000 },
  carplant:   { name:'Car manufactory', cat:'industry', size:[6,4], style:'factory', height:38, saw:true, chimneys:0, colors:{wall:'#B9BDBF', roof:'#5D6266'}, work:{title:'Assembler', slots:400, salary:36}, cost:30000 },
  greenhouse: { name:'Greenhouses', cat:'industry', size:[3,2], style:'glasshouse', work:{title:'Gardener', slots:12, salary:18}, cost:2000 },
  // ---------- services
  commissariat:{ name:'Police headquarters', cat:'services', size:[3,2], style:'block', height:52, mansard:true, sign:'#2F4A7A', label:'POLICE', colors:{wall:'#E3DCC8', roof:'#2F4A7A', trim:'#2F4A7A'}, work:{title:'Detective', slots:20, salary:32}, cost:9000 },
  firetower:  { name:'Fire station with watchtower', cat:'services', size:[2,2], style:'block', height:30, garage:'#C8382E', watchtower:true, colors:{wall:'#B5543E', roof:'#5E5A57', trim:'#C8382E'}, work:{title:'Firefighter', slots:12, salary:30}, cost:7000 },
  hospital:   { name:'Hospital', cat:'services', size:[4,3], style:'block', height:70, cross:true, colors:{wall:'#F2F0EA', roof:'#8FA3A8', trim:'#C8382E'}, work:{title:'Doctor', slots:80, salary:40}, cost:15000 },
  baths:      { name:'Public baths', cat:'services', size:[3,2], style:'dome', height:30, colors:{wall:'#E9E3D3', roof:'#6E9A8C'}, work:{title:'Attendant', slots:20, salary:24}, leisure:true, visitors:200, cost:9000 },
  kindergarten:{ name:'Kindergarten', cat:'services', size:[2,1], style:'house', height:20, roofH:14, colors:{wall:'#F2C94C', roof:'#D9714A', trim:'#3E7A4B'}, work:{title:'Teacher', slots:6, salary:26}, cost:2400 },
  openschool: { name:'Open-air school', cat:'services', size:[3,2], style:'block', height:30, ribbon:true, colors:{wall:'#F2F0EA', roof:'#9C9A95', trim:'#2F7D63'}, work:{title:'Teacher', slots:15, salary:30}, cost:6000 },
  college:    { name:'College', cat:'services', size:[3,3], style:'block', height:50, mansard:true, colors:{wall:'#B5543E', roof:'#5B6672', trim:'#EDE3CC'}, work:{title:'Lecturer', slots:40, salary:36}, cost:11000 },
  university: { name:'University', cat:'services', size:[4,4], style:'block', height:60, columns:true, mansard:true, colors:{wall:'#E3DCC8', roof:'#5E7D6A', trim:'#8A7F6A'}, work:{title:'Professor', slots:120, salary:40}, cost:20000 },
  courthouse: { name:'Courthouse', cat:'services', size:[3,2], style:'block', height:44, columns:true, colors:{wall:'#E9E3D3', roof:'#8C8783', trim:'#8A7F6A'}, work:{title:'Judge', slots:20, salary:38}, cost:9000 },
  busdepot:   { name:'Bus depot', cat:'services', size:[3,2], style:'factory', height:22, colors:{wall:'#E7D3B0', roof:'#7C8288'}, work:{title:'Driver', slots:20, salary:22}, cost:4000 },
  trainstation:{ name:'Train station', cat:'services', size:[4,2], style:'block', height:40, clock:true, colors:{wall:'#C99A62', roof:'#5E5A57', trim:'#EDE3CC'}, work:{title:'Conductor', slots:30, salary:26}, cost:9000 },
  // ---------- utilities
  substation: { name:'Substation', cat:'utilities', size:[2,2], style:'substation', cost:1500 },
  powerplant: { name:'Power plant', cat:'utilities', size:[4,4], style:'cooling', work:{title:'Operator', slots:40, salary:34}, cost:18000 },
  chp:        { name:'Heat & power plant', cat:'utilities', size:[2,2], style:'factory', height:40, chimneys:1, colors:{wall:'#B9B2A3', roof:'#6E7378'}, work:{title:'Operator', slots:20, salary:32}, cost:9000 },
  waterintake:{ name:'Water intake', cat:'utilities', size:[2,1], style:'house', height:16, roofH:10, colors:{wall:'#C9B79A', roof:'#4C5A6B', trim:'#3F3A33'}, work:{title:'Engineer', slots:4, salary:24}, cost:2000 },
  artesian:   { name:'Artesian well', cat:'utilities', size:[1,1], style:'well', colors:{wall:'#9CC4B8', roof:'#4C5A6B'}, cost:1500 },
  waterworks: { name:'Waterworks', cat:'utilities', size:[3,3], style:'block', height:30, colors:{wall:'#B5543E', roof:'#5E8F4E', trim:'#EDE3CC'}, work:{title:'Engineer', slots:20, salary:28}, cost:8000 },
  outfall:    { name:'Sewage outfall', cat:'utilities', size:[1,1], style:'outfall', cost:1000 },
  treatment:  { name:'Small treatment plant', cat:'utilities', size:[2,2], style:'ponds', work:{title:'Technician', slots:6, salary:24}, cost:3000 },
  treatponds: { name:'Treatment ponds', cat:'utilities', size:[3,3], style:'ponds', work:{title:'Technician', slots:8, salary:24}, cost:4500 },
  sewageplant:{ name:'Sewage treatment plant', cat:'utilities', size:[3,3], style:'ponds', round:true, work:{title:'Technician', slots:20, salary:26}, cost:8000 },
  landfill:   { name:'Landfill', cat:'utilities', size:[3,3], style:'landfill', work:{title:'Operator', slots:6, salary:18}, outdoor:true, cost:2500 },
  recycling:  { name:'Recycling center', cat:'utilities', size:[3,2], style:'yard', scrap:true, colors:{wall:'#7DA06A', roof:'#5E7D6A'}, work:{title:'Sorter', slots:14, salary:20}, cost:5000 },
  incinerator:{ name:'Incinerator', cat:'utilities', size:[2,2], style:'factory', height:30, chimneys:1, colors:{wall:'#9EA3A6', roof:'#5D6266'}, work:{title:'Operator', slots:12, salary:26}, cost:9000 },
  // ---------- parks
  fountainsquare:{ name:'Fountain square', cat:'parks', size:[3,3], style:'square', center:'fountain', leisure:true, visitors:320, outdoor:true, cost:1500 },
  transitsquare:{ name:'Metro square', cat:'parks', size:[3,3], style:'square', center:'metro', leisure:true, visitors:200, outdoor:true, cost:1800 },
  gazebo:     { name:'Square with a gazebo', cat:'parks', size:[3,3], style:'square', center:'gazebo', leisure:true, visitors:260, outdoor:true, cost:1600 },
  allotments: { name:'Allotment gardens', cat:'parks', size:[3,3], style:'farm', pattern:'plots', colors:{soil:'#9A7A50', crop:'#7DB656'}, leisure:true, visitors:300, outdoor:true, cost:1200 },
  botanical:  { name:'Botanical garden', cat:'parks', size:[3,3], style:'garden', leisure:true, visitors:280, outdoor:true, cost:2200 },
  football:   { name:'Football pitch', cat:'parks', size:[4,3], style:'pitch', pitch:'football', leisure:true, visitors:200, outdoor:true, cost:2000 },
  tennis:     { name:'Tennis courts', cat:'parks', size:[2,2], style:'pitch', pitch:'tennis', leisure:true, visitors:30, outdoor:true, cost:900 },
  basketball: { name:'Basketball court', cat:'parks', size:[2,2], style:'pitch', pitch:'basket', leisure:true, visitors:30, outdoor:true, cost:800 },
  stadium:    { name:'Stadium', cat:'parks', size:[6,5], style:'stadium', work:{title:'Groundskeeper', slots:30, salary:24}, leisure:true, visitors:2000, cost:24000 },
  // ---------- street furniture
  bistro:     { name:'Bistro table', cat:'decor', size:[1,1], style:'prop', prop:'bistro', outdoor:true, leisure:true, visitors:4, cost:40 },
  mailbox:    { name:'Mailbox', cat:'decor', size:[1,1], style:'prop', prop:'mailbox', outdoor:true, cost:20 },
  hydrant:    { name:'Fire hydrant', cat:'decor', size:[1,1], style:'prop', prop:'hydrant', outdoor:true, cost:20 },
  phonebooth: { name:'Phone booth', cat:'decor', size:[1,1], style:'prop', prop:'phone', outdoor:true, cost:60 },
  newsstand:  { name:'Newspaper kiosk', cat:'decor', size:[1,1], style:'prop', prop:'kiosk', outdoor:true, cost:80 },
  planter:    { name:'Planter', cat:'decor', size:[1,1], style:'prop', prop:'planter', outdoor:true, cost:25 },
  fence:      { name:'Picket fence', cat:'decor', size:[1,1], style:'prop', prop:'fence', outdoor:true, cost:10 },
  parkinglot: { name:'Parking lot', cat:'decor', size:[2,2], style:'parking', outdoor:true, cost:300 },
  // ---------- landmarks
  cathedral:  { name:'Cathedral', cat:'landmarks', size:[3,4], style:'cathedral', colors:{wall:'#D8D0BE', roof:'#5B6672'}, leisure:true, visitors:200, cost:20000 },
  castle:     { name:'Castle ruin', cat:'landmarks', size:[3,3], style:'castle', leisure:true, visitors:120, outdoor:true, cost:8000 },
  glasspalace:{ name:'Glass palace', cat:'landmarks', size:[4,3], style:'glasshouse', palace:true, leisure:true, visitors:300, cost:14000 },
  observatory:{ name:'Observatory', cat:'landmarks', size:[2,2], style:'dome', slit:true, height:26, colors:{wall:'#E9E3D3', roof:'#F4F4F0'}, leisure:true, visitors:60, cost:6000 },
  museum:     { name:'Museum', cat:'landmarks', size:[3,2], style:'block', height:40, columns:true, colors:{wall:'#E9E3D3', roof:'#8C8783', trim:'#8A7F6A'}, work:{title:'Curator', slots:15, salary:30}, leisure:true, visitors:250, cost:12000 },
  opera:      { name:'Opera house', cat:'landmarks', size:[3,3], style:'block', height:46, columns:true, cupola:true, colors:{wall:'#EDE3CC', roof:'#5E7D6A', trim:'#B5913C'}, work:{title:'Singer', slots:30, salary:34}, leisure:true, visitors:400, cost:16000 },
  atom:       { name:'Atom monument', cat:'landmarks', size:[2,2], style:'atom', leisure:true, visitors:80, outdoor:true, cost:9000 },
  lighthouse: { name:'Lighthouse', cat:'landmarks', size:[1,1], style:'lighthouse', cost:4000 },
  ferris:     { name:'Ferris wheel', cat:'landmarks', size:[2,2], style:'ferris', leisure:true, visitors:120, outdoor:true, cost:7000 },
  // ---------- nature
  cherry:     { name:'Cherry tree', cat:'nature', size:[1,1], style:'tree', colors:{leaf:'#F2A7C3'}, outdoor:true, cost:10 },
  maple:      { name:'Autumn maple', cat:'nature', size:[1,1], style:'tree', colors:{leaf:'#E07A3A'}, outdoor:true, cost:10 },
  poplar:     { name:'Poplar', cat:'nature', size:[1,1], style:'poplar', colors:{leaf:'#6FA94F'}, outdoor:true, cost:10 },
  palm:       { name:'Palm tree', cat:'nature', size:[1,1], style:'palm', colors:{leaf:'#5E9E45'}, outdoor:true, cost:15 },
  wheat:      { name:'Wheat field', cat:'nature', size:[3,2], style:'farm', colors:{soil:'#9A7A50', crop:'#E6C35C'}, work:{title:'Farmer', slots:2, salary:16}, outdoor:true, cost:400 },
  sunflowers: { name:'Sunflower field', cat:'nature', size:[3,2], style:'farm', pattern:'sunflower', colors:{soil:'#7DA04A', crop:'#F2C230'}, work:{title:'Farmer', slots:2, salary:16}, outdoor:true, cost:450 },
  vegetables: { name:'Vegetable patch', cat:'nature', size:[2,2], style:'farm', pattern:'veg', colors:{soil:'#8A6A44', crop:'#5E9E45'}, work:{title:'Grower', slots:2, salary:16}, outdoor:true, cost:350 },
  vineyard:   { name:'Vineyard', cat:'nature', size:[3,3], style:'farm', pattern:'vines', colors:{soil:'#A68A5E', crop:'#4E7F37'}, work:{title:'Vintner', slots:3, salary:18}, outdoor:true, cost:600 },
  orchard:    { name:'Orchard', cat:'nature', size:[3,3], style:'farm', pattern:'orchard', colors:{soil:'#86BE5C', crop:'#6FAE45'}, work:{title:'Picker', slots:3, salary:16}, outdoor:true, cost:600 },
  lavender:   { name:'Lavender field', cat:'nature', size:[3,2], style:'farm', pattern:'lavender', colors:{soil:'#8A7A5A', crop:'#9C7FD0'}, work:{title:'Farmer', slots:2, salary:16}, outdoor:true, cost:450 },
  pasture:    { name:'Pasture', cat:'nature', size:[3,3], style:'farm', pattern:'pasture', colors:{soil:'#8FC463', crop:'#F4F1E8'}, work:{title:'Shepherd', slots:1, salary:14}, outdoor:true, cost:300 },
};

// ---------- November 2026: fences that join up, skyscrapers, big venues, more industry, shops, services and decorations ----------
// `as` marks a bigger version of a building that works exactly like the original (a grand casino plays the casino's games,
// a grand racetrack hosts the races, a prison holds those the police lock up).
Object.assign(BUILDING_TYPES, {
  // Fences join up with any fence on the tiles beside them, so they turn corners, make T-junctions and cross in every direction.
  fence:       { name:'Picket fence', cat:'decor', sub:'fences', size:[1,1], style:'fence', kind:'picket', colors:{wall:'#F4F1E8'}, outdoor:true, cost:10 },
  woodfence:   { name:'Wooden rail fence', cat:'decor', size:[1,1], style:'fence', kind:'rail', colors:{wall:'#A9794C'}, outdoor:true, cost:12 },
  ironfence:   { name:'Iron railings', cat:'decor', size:[1,1], style:'fence', kind:'iron', colors:{wall:'#2B2F33'}, outdoor:true, cost:30 },
  stonewall:   { name:'Dry-stone wall', cat:'decor', size:[1,1], style:'fence', kind:'stone', colors:{wall:'#A8A296'}, outdoor:true, cost:25 },
  brickwall:   { name:'Brick garden wall', cat:'decor', size:[1,1], style:'fence', kind:'brick', colors:{wall:'#B5543E', trim:'#D8D2C4'}, outdoor:true, cost:28 },
  chainlink:   { name:'Chain-link fence', cat:'decor', size:[1,1], style:'fence', kind:'mesh', colors:{wall:'#9EA3A6'}, outdoor:true, cost:15 },
  bamboofence: { name:'Bamboo fence', cat:'decor', size:[1,1], style:'fence', kind:'bamboo', colors:{wall:'#C9B26A'}, outdoor:true, cost:18 },
  glassfence:  { name:'Glass balustrade', cat:'decor', size:[1,1], style:'fence', kind:'glass', colors:{wall:'#A9D3E0', trim:'#7C8288'}, outdoor:true, cost:40 },
  hedgerow:    { name:'Box hedge row', cat:'decor', size:[1,1], style:'fence', kind:'hedge', colors:{wall:'#4E8A3A'}, outdoor:true, cost:20 },
  whitewall:   { name:'Rendered wall with lamps', cat:'decor', size:[1,1], style:'fence', kind:'render', colors:{wall:'#EDE6D6', trim:'#B9AE98'}, outdoor:true, cost:35 },

  // ---- street furniture ----
  bin:         { name:'Litter bin', cat:'decor', size:[1,1], style:'prop', prop:'bin', outdoor:true, cost:15 },
  recycle:     { name:'Recycling bins', cat:'decor', size:[1,1], style:'prop', prop:'recycle', outdoor:true, cost:30 },
  bikerack:    { name:'Bike rack', cat:'decor', size:[1,1], style:'prop', prop:'bikerack', outdoor:true, cost:25 },
  bollards:    { name:'Bollards', cat:'decor', size:[1,1], style:'prop', prop:'bollards', outdoor:true, cost:12 },
  traffic:     { anim:true, name:'Traffic light', cat:'decor', size:[1,1], style:'prop', prop:'traffic', outdoor:true, cost:60 },
  streetsign:  { name:'Street sign', cat:'decor', size:[1,1], style:'prop', prop:'sign', outdoor:true, cost:20 },
  atm:         { name:'Cash machine', cat:'decor', size:[1,1], style:'prop', prop:'atm', outdoor:true, cost:90 },
  vending:     { name:'Vending machine', cat:'decor', size:[1,1], style:'prop', prop:'vending', outdoor:true, cost:70 },
  flagpole:    { anim:true, name:'Flag pole', cat:'decor', size:[1,1], style:'prop', prop:'flag', outdoor:true, cost:45 },
  stringlights:{ anim:true, name:'Festoon lights', cat:'decor', size:[1,1], style:'prop', prop:'festoon', outdoor:true, cost:40 },
  picnic:      { name:'Picnic table', cat:'decor', size:[1,1], style:'prop', prop:'picnic', outdoor:true, leisure:true, visitors:6, cost:35 },
  parasol:     { name:'Café parasol', cat:'decor', size:[1,1], style:'prop', prop:'parasol', outdoor:true, leisure:true, visitors:4, cost:45 },
  drinking:    { name:'Drinking fountain', cat:'decor', size:[1,1], style:'prop', prop:'drink', outdoor:true, cost:40 },
  noticeboard: { name:'Notice board', cat:'decor', size:[1,1], style:'prop', prop:'notice', outdoor:true, cost:25 },
  mapboard:    { name:'Town map board', cat:'decor', size:[1,1], style:'prop', prop:'mapboard', outdoor:true, cost:30 },
  meter:       { name:'Parking meter', cat:'decor', size:[1,1], style:'prop', prop:'meter', outdoor:true, cost:20 },
  potplants:   { name:'Flower pots', cat:'decor', size:[1,1], style:'prop', prop:'pots', outdoor:true, cost:20 },
  treepot:     { name:'Tree in a planter', cat:'decor', size:[1,1], style:'prop', prop:'treepot', outdoor:true, cost:40 },
  palmpot:     { name:'Potted palm', cat:'decor', size:[1,1], style:'prop', prop:'palmpot', outdoor:true, cost:40 },
  flowerarch:  { name:'Rose arch', cat:'decor', size:[1,1], style:'prop', prop:'arch', outdoor:true, cost:50 },
  sculpture:   { name:'Street sculpture', cat:'decor', size:[1,1], style:'prop', prop:'sculpt', outdoor:true, cost:120 },
  lamp2:       { name:'Double lantern', cat:'decor', size:[1,1], style:'prop', prop:'lantern', outdoor:true, cost:70 },
  benchmod:    { name:'Modern bench', cat:'decor', size:[1,1], style:'prop', prop:'benchmod', outdoor:true, leisure:true, visitors:4, cost:50 },
  snowman:     { name:'Snowman', cat:'decor', size:[1,1], style:'prop', prop:'snowman', outdoor:true, cost:15 },
  giftpile:    { name:'Gift boxes', cat:'decor', size:[1,1], style:'prop', prop:'gifts', outdoor:true, cost:25 },

  // ---- nature ----
  xmastree:    { name:'Christmas tree', cat:'nature', size:[1,1], style:'xmastree', colors:{leaf:'#2F6E3B'}, outdoor:true, cost:80 },
  bigxmastree: { name:'Giant Christmas tree', cat:'nature', size:[2,2], style:'xmastree', big:true, colors:{leaf:'#2F6E3B'}, outdoor:true, leisure:true, visitors:60, cost:1200 },
  snowpine:    { name:'Snowy pine', cat:'nature', size:[1,1], style:'xmastree', snow:true, plain:true, colors:{leaf:'#3E7A4B'}, outdoor:true, cost:15 },
  cactus:      { name:'Cactus', cat:'nature', sub:'rocks', size:[1,1], style:'prop', prop:'cactus', outdoor:true, cost:10 },
  willow:      { name:'Weeping willow', cat:'nature', size:[1,1], style:'prop', prop:'willow', outdoor:true, cost:15 },
  flowerbush:  { name:'Flowering bush', cat:'nature', sub:'rocks', size:[1,1], style:'prop', prop:'flowerbush', outdoor:true, cost:8 },

  // ---- landmarks ----
  arch:        { name:'Triumphal arch', cat:'landmarks', size:[3,1], style:'arch', colors:{wall:'#E4DCC8'}, leisure:true, visitors:60, outdoor:true, cost:15000 },
  column:      { name:'Victory column', cat:'landmarks', size:[1,1], style:'column', colors:{wall:'#D9D2C0', trim:'#E2B13C'}, leisure:true, visitors:30, outdoor:true, cost:6000 },
  globe:       { name:'Globe monument', cat:'landmarks', size:[2,2], style:'globe', colors:{wall:'#9FB6BE'}, leisure:true, visitors:60, outdoor:true, cost:9000 },
  giantflag:   { anim:true, name:'Giant flag', cat:'landmarks', size:[1,1], style:'prop', prop:'giantflag', outdoor:true, leisure:true, visitors:10, cost:3000 },
  bandstand:   { name:'Bandstand', cat:'landmarks', size:[2,2], style:'bandstand', colors:{wall:'#F4F1E8', roof:'#2F6E5A'}, leisure:true, visitors:80, outdoor:true, cost:4000 },
  horsestatue: { name:'Equestrian statue', cat:'landmarks', size:[2,2], style:'horse', colors:{wall:'#5E7A6A'}, leisure:true, visitors:30, outdoor:true, cost:7000 },
  tvtower:     { name:'TV tower', cat:'landmarks', size:[2,2], style:'needle', height:300, colors:{wall:'#D8D8D4', roof:'#C8382E'}, work:{title:'Broadcaster', slots:20, salary:40}, leisure:true, visitors:200, cost:60000 },
  glasspyramid:{ name:'Glass pyramid', cat:'landmarks', size:[3,3], style:'pyramid', colors:{wall:'#A9C6D8', trim:'#5E6E78'}, work:{title:'Curator', slots:24, salary:34}, leisure:true, visitors:300, cost:45000 },

  // ---- skyscrapers: offices and homes in the sky ----
  spiretower:  { name:'Spire skyscraper', cat:'offices', sub:'towers', size:[3,3], style:'sky', height:290, glass:true, tiers:[[0,0.5],[0.45,0.32],[0.9,0.18]], crown:'spire', colors:{wall:'#8FB0C2', roof:'#3E4C55', trim:'#C9D6DC'}, work:{title:'Executive', slots:320, salary:56}, cost:180000 },
  glasstower:  { name:'Glass skyscraper', cat:'offices', sub:'towers', size:[2,2], style:'sky', height:240, glass:true, tiers:[[0,1]], crown:'antenna', colors:{wall:'#6FA3BF', roof:'#2F3D46', trim:'#B9D4E0'}, work:{title:'Analyst', slots:220, salary:50}, cost:120000 },
  crowntower:  { name:'Crown tower', cat:'offices', sub:'towers', size:[2,2], style:'sky', height:220, glass:true, tiers:[[0,0.8],[0.3,0.2]], crown:'crown', colors:{wall:'#B9A77A', roof:'#4E4A44', trim:'#E2B13C'}, work:{title:'Banker', slots:200, salary:54}, cost:130000 },
  decotower:   { name:'Art deco skyscraper', cat:'offices', sub:'towers', size:[2,2], style:'sky', height:250, tiers:[[0,0.45],[0.25,0.3],[0.5,0.15],[0.75,0.1]], crown:'deco', bands:true, colors:{wall:'#D9CDB4', roof:'#5E5A57', trim:'#8A7A5A'}, work:{title:'Lawyer', slots:210, salary:52}, cost:140000 },
  helitower:   { name:'Helipad tower', cat:'offices', sub:'towers', size:[2,2], style:'sky', height:200, glass:true, tiers:[[0,1]], crown:'heli', colors:{wall:'#5D6F78', roof:'#2B363C', trim:'#9FB6BE'}, work:{title:'Consultant', slots:180, salary:50}, cost:110000 },
  twintowers:  { name:'Twin towers', cat:'offices', sub:'towers', size:[4,2], style:'sky', height:260, glass:true, twins:true, tiers:[[0,1]], crown:'antenna', colors:{wall:'#9BB7C2', roof:'#4E5D66', trim:'#E8EEF2'}, work:{title:'Trader', slots:420, salary:54}, cost:240000 },
  pyramidtower:{ name:'Pyramid skyscraper', cat:'offices', sub:'towers', size:[3,3], style:'sky', height:230, tiers:[[0,0.3],[0.3,0.25],[0.6,0.2],[0.85,0.15],[1.1,0.1]], crown:'spire', colors:{wall:'#E8E6E0', roof:'#9EA3A6', trim:'#7C8288'}, work:{title:'Engineer', slots:300, salary:50}, cost:170000 },
  skyresidence:{ name:'Sky residences', cat:'housing', sub:'highrise', size:[2,2], style:'sky', height:210, tiers:[[0,0.85],[0.3,0.15]], crown:'garden', balconies:true, colors:{wall:'#E4DED2', roof:'#5E8F4E', trim:'#9C8A70'}, home:{capacity:140, rent:40}, cost:90000 },
  luxurytower: { name:'Luxury glass residences', cat:'housing', sub:'highrise', size:[2,2], style:'sky', height:250, glass:true, tiers:[[0,1]], crown:'crown', colors:{wall:'#7FA6B8', roof:'#2F3D46', trim:'#E2B13C'}, home:{capacity:160, rent:55}, cost:140000 },

  // ---- industry: the bigger the investment, the more people it employs ----
  datacentre:  { name:'Data centre', cat:'industry', sub:'tech', size:[4,3], style:'block', height:34, rooftop:true, colors:{wall:'#E8E8E4', roof:'#9EA3A6', trim:'#4A7BD9'}, work:{title:'Systems engineer', slots:220, salary:46}, cost:45000 },
  chipfab:     { name:'Chip foundry', cat:'industry', sub:'tech', size:[5,4], style:'block', height:42, glass:true, rooftop:true, colors:{wall:'#C9D6DC', roof:'#E8E8E4', trim:'#2F4A7A'}, work:{title:'Process engineer', slots:480, salary:52}, cost:75000 },
  pharmalab:   { name:'Pharmaceutical lab', cat:'industry', sub:'tech', size:[4,3], style:'block', height:46, glass:true, ribbon:true, colors:{wall:'#E4EEF0', roof:'#8BB3D1', trim:'#3E8F72'}, work:{title:'Scientist', slots:260, salary:48}, cost:40000 },
  brewery:     { name:'Brewery', cat:'industry', sub:'factories', size:[3,3], style:'tanks', copper:true, work:{title:'Brewer', slots:70, salary:28}, cost:12000 },
  textilemill: { name:'Textile mill', cat:'industry', sub:'factories', size:[4,3], style:'factory', height:36, saw:true, chimneys:2, colors:{wall:'#C47A52', roof:'#5E5A57'}, work:{title:'Weaver', slots:160, salary:28}, cost:16000 },
  foodplant:   { name:'Food processing plant', cat:'industry', sub:'factories', size:[4,3], style:'factory', height:30, chimneys:1, colors:{wall:'#E8E2D2', roof:'#5E8F4E'}, work:{title:'Food technician', slots:180, salary:28}, cost:18000 },
  steelmill:   { name:'Steel mill', cat:'industry', sub:'heavy', size:[5,4], style:'mill', work:{title:'Steelworker', slots:340, salary:40}, cost:42000 },
  refinery:    { name:'Oil refinery', cat:'industry', sub:'heavy', size:[5,5], style:'refinery', work:{title:'Refinery operator', slots:380, salary:44}, cost:55000 },
  aerospace:   { name:'Aerospace hangar', cat:'industry', sub:'heavy', size:[6,5], style:'hangar', colors:{wall:'#D8DCDE', roof:'#9EA3A6', trim:'#2F4A7A'}, work:{title:'Aircraft engineer', slots:620, salary:56}, cost:95000 },
  shipyard:    { name:'Container yard', cat:'industry', sub:'heavy', size:[5,4], style:'containers', work:{title:'Crane operator', slots:300, salary:38}, cost:38000 },

  // ---- shops ----
  boutique:    { name:'Fashion boutique', cat:'shops', size:[1,1], style:'block', height:30, sign:'#2B2621', label:'MODE', awning:'#2B2621', colors:{wall:'#F4F1E8', roof:'#5E5A57', trim:'#2B2621'}, work:{title:'Stylist', slots:3, salary:24}, cost:1600 },
  electronics: { name:'Electronics store', cat:'shops', size:[2,1], style:'block', height:28, glass:true, sign:'#2F4A7A', label:'TECH', colors:{wall:'#C9D6DC', roof:'#4E5D66', trim:'#2F4A7A'}, work:{title:'Sales assistant', slots:5, salary:24}, cost:2400 },
  jeweller:    { name:'Jeweller', cat:'shops', size:[1,1], style:'block', height:30, sign:'#1F3A2B', label:'GOLD', colors:{wall:'#E8DDC0', roof:'#4E4A44', trim:'#E2B13C'}, work:{title:'Jeweller', slots:2, salary:30}, cost:2200 },
  shoeshop:    { name:'Shoe shop', cat:'shops', size:[1,1], style:'block', height:26, sign:'#8A4A6A', label:'SHOES', awning:'#C86A8A', colors:{wall:'#F2E4E8', roof:'#5E5A57', trim:'#8A4A6A'}, work:{title:'Shop assistant', slots:2, salary:20}, cost:1300 },
  furniture:   { name:'Furniture store', cat:'shops', size:[3,2], style:'block', height:30, sign:'#5E4128', label:'HOME', colors:{wall:'#D8C8A8', roof:'#5E5A57', trim:'#5E4128'}, work:{title:'Sales assistant', slots:8, salary:22}, cost:4200 },
  toyshop:     { name:'Toy shop', cat:'shops', size:[1,1], style:'block', height:26, sign:'#D9544A', label:'TOYS', awning:'#F2C94C', colors:{wall:'#FCE7B0', roof:'#D9544A', trim:'#2F7D63'}, work:{title:'Shop assistant', slots:2, salary:20}, cost:1200 },
  icecream:    { name:'Ice cream parlour', cat:'shops', size:[1,1], style:'block', height:24, sign:'#E88BB0', label:'GELATO', awning:'#9FD8E0', colors:{wall:'#FFF2F6', roof:'#E88BB0', trim:'#8A4A6A'}, work:{title:'Server', slots:2, salary:18}, leisure:true, visitors:20, cost:1100 },
  burgers:     { name:'Burger bar', cat:'shops', sub:'going', size:[2,1], style:'block', height:24, sign:'#D9544A', label:'BURGERS', awning:'#F2C94C', colors:{wall:'#F4E6C8', roof:'#D9544A', trim:'#5E4128'}, work:{title:'Cook', slots:6, salary:18}, leisure:true, visitors:40, cost:2000 },
  pizzeria:    { name:'Pizzeria', cat:'shops', sub:'going', size:[2,1], style:'block', height:26, sign:'#2F7D63', label:'PIZZA', awning:'#D9544A', colors:{wall:'#F4F1E8', roof:'#B5543E', trim:'#2F7D63'}, work:{title:'Pizzaiolo', slots:5, salary:20}, leisure:true, visitors:40, cost:2200 },
  sportshop:   { name:'Sports store', cat:'shops', size:[2,2], style:'block', height:28, glass:true, sign:'#2F7D63', label:'SPORT', colors:{wall:'#D8E6DE', roof:'#4E5D66', trim:'#2F7D63'}, work:{title:'Sales assistant', slots:7, salary:22}, cost:3600 },
  megamall:    { name:'Mega mall', cat:'shops', sub:'large', size:[5,4], style:'block', height:52, glass:true, sign:'#6B2A4A', label:'MEGA MALL', neon:true, colors:{wall:'#C9D6DC', roof:'#4E5D66', trim:'#6B2A4A'}, work:{title:'Shop worker', slots:260, salary:24}, leisure:true, visitors:900, cost:65000 },
  grandcasino: { name:'Grand casino resort', as:'casino', cat:'shops', sub:'going', size:[5,5], style:'resort', colors:{wall:'#6B2A4A', roof:'#2E1A28', trim:'#F2B33D'}, work:{title:'Dealer', slots:60, salary:40}, leisure:true, visitors:1200, cost:120000 },
  gamearena:   { name:'Game arena', as:'gamehouse', cat:'shops', sub:'going', size:[4,4], style:'block', height:56, sign:'#1F3A6B', label:'GAME ARENA', neon:true, glass:true, colors:{wall:'#2F4F7F', roof:'#1C2C47', trim:'#F2C94C'}, work:{title:'Game host', slots:40, salary:30}, leisure:true, visitors:600, cost:60000 },

  // ---- services ----
  prison:      { name:'Prison', as:'jail', cat:'services', sub:'safety', size:[4,4], style:'prison', colors:{wall:'#B9B5AB', roof:'#5D6266', trim:'#2F3438'}, work:{title:'Guard', slots:30, salary:32}, cost:22000 },
  firehq:      { name:'Fire headquarters', cat:'services', sub:'safety', size:[4,2], style:'block', height:36, garage:'#C8382E', sign:'#C8382E', label:'FIRE', colors:{wall:'#C8644A', roof:'#5E5A57', trim:'#C8382E'}, work:{title:'Firefighter', slots:24, salary:32}, cost:12000 },
  policeplaza: { name:'Police plaza', cat:'services', sub:'safety', size:[3,3], style:'block', height:70, glass:true, sign:'#2F4A7A', label:'POLICE', colors:{wall:'#9BB0C8', roof:'#2F4A7A', trim:'#2F4A7A'}, work:{title:'Detective', slots:40, salary:36}, cost:18000 },
  ambulance:   { name:'Ambulance station', cat:'services', sub:'health', size:[3,2], style:'block', height:28, garage:'#F4F4F0', cross:true, colors:{wall:'#F4F4F0', roof:'#7C8288', trim:'#D9544A'}, work:{title:'Paramedic', slots:14, salary:32}, cost:7000 },
  cityhall:    { name:'Grand city hall', cat:'services', sub:'civic', size:[5,3], style:'block', height:48, columns:true, clock:true, colors:{wall:'#E4DCC8', roof:'#5E6E78', trim:'#8A7A5A'}, work:{title:'Clerk', slots:60, salary:30}, cost:40000 },
  parliament:  { name:'Parliament', cat:'services', sub:'civic', size:[5,4], style:'block', height:44, columns:true, cupola:true, colors:{wall:'#E8E2D2', roof:'#4E7A6A', trim:'#8A7A5A'}, work:{title:'Official', slots:80, salary:40}, cost:60000 },
  embassy:     { name:'Embassy', cat:'services', sub:'civic', size:[2,2], style:'block', height:34, columns:true, colors:{wall:'#F0EBDF', roof:'#5E5A57', trim:'#8A7A5A'}, work:{title:'Diplomat', slots:12, salary:44}, cost:9000 },
  dispatch:    { name:'Emergency dispatch centre', cat:'services', sub:'safety', size:[2,2], style:'block', height:38, glass:true, rooftop:true, colors:{wall:'#D8DCDE', roof:'#4E5D66', trim:'#D9544A'}, work:{title:'Dispatcher', slots:18, salary:34}, cost:8000 },
  coastguard:  { name:'Coast guard station', cat:'services', sub:'safety', size:[2,2], style:'house', height:26, roofH:16, colors:{wall:'#F4F4F0', roof:'#D9544A', trim:'#2F4A7A'}, work:{title:'Rescuer', slots:10, salary:30}, cost:6000 },

  // ---- big venues ----
  grandracetrack:{ name:'Grand racecourse', as:'racetrack', cat:'parks', sub:'sports', size:[9,5], style:'racetrack', grand:true, colors:{grass:'#7DB656', dirt:'#C9A06A', stand:'#2F4A7A'}, work:{title:'Creature keeper', slots:20, salary:28}, leisure:true, visitors:600, outdoor:true, cost:40000 },
  colosseum:   { name:'Colosseum', note:'home of Fight Night', cat:'parks', sub:'sports', size:[10,9], style:'colosseum', colors:{wall:'#D9C7A3', roof:'#B9A27A', trim:'#8A2A22', sand:'#E3C88E'}, work:{title:'Fight promoter', slots:80, salary:30}, leisure:true, visitors:5000, cost:90000 },
  bigstadium:  { name:'Stadium', cat:'parks', sub:'sports', size:[12,10], style:'arena', colors:{wall:'#E8E6E0', roof:'#F4F4F0', trim:'#2F4A7A', seat:'#C8382E', seat2:'#2F4A7A'}, work:{title:'Groundskeeper', slots:160, salary:28}, leisure:true, visitors:9000, cost:110000 },
});
for (const t of Object.values(BUILDING_TYPES)) if (t.style === 'fence') t.sub = 'fences';
for (const k of ['flowers', 'hedge', 'planter', 'potplants', 'treepot', 'palmpot', 'flowerarch', 'snowman', 'giftpile']) BUILDING_TYPES[k].sub = 'plants';
BUILDING_TYPES.stadium.name = 'Sports ground'; // the old stadium is a quarter the size of the new one
BUILDING_TYPES.racetrack.name = 'Racetrack';
// Which kind a building works as (a grand casino is a casino, a prison a jail…).
export const kindOf = type => BUILDING_TYPES[type]?.as || type;
export const typesOf = kind => Object.keys(BUILDING_TYPES).filter(k => kindOf(k) === kind);
export const pgList = kind => '{' + typesOf(kind).join(',') + '}'; // for SQL: type = any('{casino,grandcasino}')

// Tabs inside each build menu. Anything without a sub shows under its menu's first tab.
export const SUBS = {
  roads:     [['streets','Streets'],['curbside','Curbside'],['wide','Wide'],['highway','Highway'],['rail','Rail'],['surface','Surfaces']],
  housing:   [['houses','Houses'],['lowrise','Low-rise'],['highrise','High-rise']],
  shops:     [['small','Small'],['large','Large'],['going','Going out']],
  industry:  [['workshops','Workshops'],['factories','Factories'],['heavy','Heavy'],['tech','High-tech'],['farms','Farms']],
  offices:   [['offices','Offices'],['towers','Skyscrapers']],
  decor:     [['furniture','Street furniture'],['fences','Fences & walls'],['plants','Plants & festive']],
  services:  [['safety','Safety'],['health','Health'],['education','Education'],['civic','Civic']],
  utilities: [['power','Power'],['water','Water'],['sewage','Sewage'],['garbage','Garbage']],
  parks:     [['squares','Parks & squares'],['sports','Sports']],
  nature:    [['trees','Trees'],['fields','Fields'],['rocks','Rocks & bushes']],
};
const SUB_OF = {
  houses:['tent','cabin','cottage','house','timber','gablecottage','chalet','villa','garagevilla'],
  lowrise:['rowhouses','brickflats','townhouse','townhouses','canalhouses','baroquegables','workers','walkup','mews','almshouse','terraces','slab50s','haussmann','georgian','courtyard','arcadehouse','artnouveau'],
  highrise:['apartment','aptower','gallery','altbau','pilotis','domedapt','cubetower','steppedtower','balconyblock','belletower'],
  small:['stall','bakery','cafe','bookshop','grocer','cornershop','florist','petstore','pharmacy','openmarket'],
  large:['supermarket','deptstore','markethall','arcade','mall','gasstation','hotel','cardealer'],
  going:['tavern','casino','gamehouse','diner','restaurant','cinema'],
  workshops:['lumber','workshop','garage','printshop','lumberyard','canalwarehouses','warehouse'],
  factories:['factory','chemplant','brickworks','chocolate','gasworks','porcelain','tireplant','carplant'],
  farms:['farm','windmill','silo','winery','greenhouse'],
  safety:['police','jail','fire','commissariat','firetower'],
  health:['clinic','hospital','baths'],
  education:['school','library','kindergarten','openschool','college','university'],
  civic:['townhall','postoffice','courthouse','busdepot','trainstation'],
  power:['turbine','solar','pylon','substation','powerplant','chp'],
  water:['watertower','pump','waterintake','artesian','waterworks'],
  sewage:['outfall','treatment','treatponds','sewageplant'],
  garbage:['landfill','recycling','incinerator'],
  squares:['park','garden','playground','square','fountain','fountainsquare','transitsquare','gazebo','allotments','botanical'],
  sports:['racetrack','gym','fitpark','football','tennis','basketball','stadium'],
  trees:['tree','pine','birch','cherry','maple','poplar','palm'],
  fields:['wheat','sunflowers','vegetables','vineyard','orchard','lavender','pasture'],
  rocks:['bush','rocks'],
};
for (const [sub, ids] of Object.entries(SUB_OF)) for (const id of ids) if (BUILDING_TYPES[id]) BUILDING_TYPES[id].sub = sub;
for (const t of Object.values(BUILDING_TYPES)) if (!t.sub && SUBS[t.cat]) t.sub = SUBS[t.cat][0][0]; // anything else: its menu's first tab


// ---------- water, vehicles, disasters, weather ----------
export const WATER_TYPES = {
  river: { name:'River', note:'flowing water', color:'#6FB3D2', deep:'#5A9EC0' },
  lake:  { name:'Lake', note:'calm water', color:'#62A8CC', deep:'#4F92B8' },
  sea:   { name:'Sea', note:'deep water with waves', color:'#4D8FB8', deep:'#3B78A0' },
};

export const VEHICLE_TYPES = {
  car:       { name:'Car', note:'roams the streets', len:0.62, wid:0.3, h:6, colors:['#D9544A','#F2F0EA','#E6C35C','#5B8DB8','#7C8288','#3E7A4B'] },
  taxi:      { name:'Taxi', note:'picks people up', len:0.62, wid:0.3, h:6, colors:['#F2C230'], sign:true },
  bus:       { name:'Bus', note:'big and slow', len:1.15, wid:0.34, h:10, colors:['#E2A23B'], windows:true, speed:0.7 },
  van:       { name:'Delivery van', note:'brings goods to shops', len:0.72, wid:0.32, h:9, colors:['#F2F0EA','#8BB3D1'] },
  truck:     { name:'Truck', note:'heavy goods', len:1.0, wid:0.34, h:10, colors:['#5E7C99'], cargo:'#C9B79A', speed:0.8 },
  police:    { name:'Police car', note:'patrols the city', len:0.66, wid:0.3, h:6, colors:['#F4F4F0'], stripe:'#2F4A7A', siren:'#4A7BD9' },
  firetruck: { name:'Fire engine', note:'answers fires', len:1.05, wid:0.34, h:10, colors:['#C8382E'], ladder:true, siren:'#FF5544' },
  ambulance: { name:'Ambulance', note:'answers emergencies', len:0.8, wid:0.32, h:9, colors:['#F4F4F0'], stripe:'#D9544A', siren:'#FF5544' },
  // Two wheels on the road; boats on water (mode 'water'); aircraft in the sky above where they're placed (mode 'air').
  bike:      { name:'Bicycle', note:'pedals round the streets', shape:'bike', len:0.36, wid:0.1, h:9, colors:['#D9544A','#4A7BD9','#2F7D63','#F2C94C'], speed:0.55 },
  motorbike: { name:'Motorbike', note:'nips through traffic', shape:'moto', len:0.42, wid:0.14, h:9, colors:['#2B2621','#C8382E','#2F4A7A'], speed:1.25 },
  boat:      { name:'Motor boat', note:'cruises the water', mode:'water', shape:'boat', len:0.7, wid:0.3, h:5, colors:['#F4F4F0','#D9544A','#2F4A7A'], speed:1.1 },
  sailboat:  { name:'Sailing boat', note:'drifts on the breeze', mode:'water', shape:'sail', len:0.75, wid:0.28, h:5, colors:['#F4F4F0','#E8DDC0'], speed:0.6 },
  ferry:     { name:'Ferry', note:'carries passengers', mode:'water', shape:'ferry', len:1.7, wid:0.55, h:8, colors:['#F4F4F0'], speed:0.7 },
  cargoship: { name:'Cargo ship', note:'big and slow', mode:'water', shape:'cargo', len:2.6, wid:0.7, h:8, colors:['#2F4A7A','#8C2F2A'], speed:0.45 },
  plane:     { name:'Plane', note:'flies big loops over the colony', mode:'air', shape:'plane', len:1.4, wid:1.4, h:6, alt:150, colors:['#F4F4F0'], speed:3 },
  helicopter:{ name:'Helicopter', note:'hovers and circles', mode:'air', shape:'heli', len:0.8, wid:0.4, h:8, alt:80, colors:['#C8382E','#2F4A7A','#F2C94C'], speed:1.2 },
  balloon:   { name:'Hot-air balloon', note:'floats slowly', mode:'air', shape:'balloon', len:0.5, wid:0.5, h:30, alt:110, colors:['#D9544A','#F2C94C','#4A7BD9'], speed:0.25 },
};

// Cars a colonist can buy from the dealer. They draw like the car above, in the size and colour of the model.
// What each car cost before the October 2026 repricing: a car bought then sells back for 60% of what was paid for it.
export const OLD_CAR_PRICES = { hatch: 1500, sedan: 3000, pickup: 5000, suv: 6500, sports: 14000 };
export const carPaid = car => Number(car?.paid) || OLD_CAR_PRICES[car?.m] || 0;
export const CAR_MODELS = {
  hatch:  { name:'Hatchback',  price:25000, upkeep:25,  len:0.54, wid:0.28, h:6, colors:['#D9544A','#5B8DB8','#E6C35C','#3E7A4B','#F2F0EA','#2B2621'] },
  sedan:  { name:'Sedan',      price:45000, upkeep:45,  len:0.64, wid:0.3,  h:6, colors:['#7C8288','#2F4A7A','#F2F0EA','#8C2F1B','#2B2621','#3E7A4B'] },
  pickup: { name:'Pickup',     price:70000, upkeep:70,  len:0.72, wid:0.32, h:7, cargo:'#8C7B66', colors:['#C8382E','#2F4A7A','#E2A23B','#F2F0EA','#4A5A44'] },
  suv:    { name:'SUV',        price:95000, upkeep:95,  len:0.7,  wid:0.33, h:8, colors:['#2B2621','#F2F0EA','#5E7C99','#8C2F1B','#7C8288'] },
  sports: { name:'Sports car', price:300000, upkeep:300, len:0.66, wid:0.3,  h:5, colors:['#E4572E','#F2B33D','#2E5E8C','#F2F0EA','#2B2621'] },
};

export const DISASTER_TYPES = {
  fire:       { name:'Fire', note:'burns a block', radius:2 },
  tornado:    { name:'Tornado', note:'tears a path', radius:2, length:26 },
  earthquake: { name:'Earthquake', note:'shakes a district', radius:12 },
  flood:      { name:'Flood', note:'water rises', radius:7 },
  meteor:     { name:'Meteor', note:'one big crater', radius:3 },
};

export const WEATHER_TYPES = {
  sunny:  { name:'Sunny' }, cloudy: { name:'Cloudy' }, rain: { name:'Rain' }, fog: { name:'Fog' }, storm: { name:'Storm' },
};

// A new road clears small things in its way (trees, bushes, rocks, benches, lamps and other 1×1 street furniture).
// Anything bigger, like a park, farm, or solid building, stops the road instead.
export function roadClears(type) { const t = BUILDING_TYPES[type]; if (!t) return false; const [w, d] = t.size;
  return t.cat === 'nature' || (t.cat === 'decor' && w === 1 && d === 1); }
