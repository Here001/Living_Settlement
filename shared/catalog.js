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
   ADD A ROAD: add an entry to ROAD_TYPES (kind: street | cobble | dirt).
   This file is shared: the server validates builds with it, the browser draws with it.
   TIME: 1 real day = 4 game days. The world is a pure function of the clock.
   ===================================================================== */

export const ROAD_TYPES = {
  street:     { name:'Street', note:'two lanes', kind:'street', top:'#7E8185', walk:'#DCD8CE', cost:30, speed:2.0 },
  trees:      { name:'Tree-lined street', note:'trees on the walks', kind:'street', deco:'trees', top:'#7E8185', walk:'#DCD8CE', cost:45, speed:2.0 },
  parking:    { name:'Street with parking', note:'cars at the curb', kind:'street', deco:'cars', top:'#7E8185', walk:'#DCD8CE', cost:40, speed:1.8 },
  pedestrian: { name:'Pedestrian lane', note:'car-free', kind:'cobble', top:'#DCCDAE', edge:'#B5A27E', cost:20, speed:1.6 },
  cobble:     { name:'Cobblestone', note:'old town', kind:'cobble', top:'#C4BDAE', edge:'#978F80', cost:15, speed:1.7 },
  plaza:      { name:'Brick plaza', note:'warm red brick', kind:'cobble', top:'#C98A72', edge:'#A0654F', cost:20, speed:1.6 },
  gravel:     { name:'Gravel path', note:'cheap and quick', kind:'dirt', top:'#CDC7B8', edge:'#A39C8C', cost:5, speed:1.4 },
  dirt:       { name:'Dirt path', note:'free', kind:'dirt', top:'#D6BE8E', edge:'#B09466', cost:0, speed:1.4 },
  asphalt:    { name:'Street', kind:'street', top:'#7E8185', walk:'#DCD8CE', cost:30, speed:2.0, hidden:true },
};

export const CATS = [
  { id:'roads',     name:'Roads' },
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
  { id:'bulldoze',  name:'Bulldoze' },
];

export const BUILDING_TYPES = {
  // ---------- housing
  tent:       { name:'Tent', cat:'housing', size:[1,1], style:'tent', colors:{wall:'#EFE4C6', roof:'#C8623F'}, home:{capacity:2, rent:0}, cost:0 },
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
};
