(function (root) {
  'use strict';

  const MAP = Object.freeze({ width: 1672, height: 941, meetingPoint: { x: 836, y: 482 } });

  const buildings = [
    { id:'production', label:'Production Office', view:'crew', rect:{x:92,y:61,w:310,h:243}, door:{x:332,y:304},
      slots:[{x:188,y:246},{x:273,y:247}] },
    { id:'writers', label:"Writers' Room", view:'scenes', rect:{x:407,y:62,w:205,h:243}, door:{x:516,y:305},
      slots:[{x:452,y:245},{x:499,y:226},{x:548,y:244},{x:568,y:174}] },
    { id:'casting', label:'Casting & Rehearsal', view:'bibles', rect:{x:617,y:64,w:165,h:241}, door:{x:704,y:305},
      slots:[{x:699,y:245}] },
    { id:'storyboard', label:'Storyboard Room', view:'boards', rect:{x:777,y:61,w:157,h:244}, door:{x:853,y:305},
      slots:[{x:817,y:237},{x:883,y:237},{x:856,y:177}] },
    { id:'wardrobe', label:'Wardrobe & Props', view:'look', rect:{x:929,y:62,w:137,h:243}, door:{x:995,y:305},
      slots:[{x:961,y:240},{x:1023,y:240}] },
    { id:'camera', label:'Camera & Lighting', view:'look', rect:{x:1056,y:48,w:285,h:258}, door:{x:1193,y:306},
      slots:[{x:1106,y:246},{x:1166,y:235},{x:1225,y:246},{x:1282,y:232}] },
    { id:'backlot', label:'Locations & Backlot', view:'bibles', rect:{x:1332,y:37,w:307,h:270}, door:{x:1391,y:305},
      slots:[{x:1478,y:245}] },
    { id:'stage-a', label:'Storyboard Stage', view:'boards', rect:{x:167,y:306,w:458,h:317}, door:{x:404,y:622},
      slots:[{x:368,y:547}] },
    { id:'stage-b', label:'Picture Stage', view:'takes', rect:{x:1000,y:306,w:410,h:316}, door:{x:1197,y:622},
      slots:[{x:1192,y:540}] },
    { id:'post', label:'Post House', view:'takes', rect:{x:72,y:641,w:296,h:221}, door:{x:260,y:862},
      slots:[{x:166,y:794},{x:292,y:792}] },
    { id:'sound', label:'Music & Sound', view:'look', rect:{x:365,y:641,w:224,h:222}, door:{x:484,y:862},
      slots:[{x:480,y:795}] },
    { id:'media', label:'Media Services', action:'settings', rect:{x:597,y:641,w:229,h:221}, door:{x:715,y:862}, slots:[] },
    { id:'taste', label:'Taste Library', view:'tasteos', rect:{x:833,y:641,w:222,h:221}, door:{x:943,y:862},
      slots:[{x:944,y:791}] },
    { id:'screening', label:'Screening Theater', view:'takes', rect:{x:1063,y:641,w:276,h:221}, door:{x:1199,y:862},
      slots:[{x:1160,y:813},{x:1242,y:813},{x:1200,y:768}] },
    { id:'client', label:'Client Room', view:'client', rect:{x:1333,y:641,w:307,h:221}, door:{x:1469,y:862}, slots:[] }
  ];

  const roleBuildings = Object.freeze({
    producer:'production', first_ad:'production',
    director:'writers', story_editor:'writers', writer:'writers', script_supervisor:'writers',
    casting_director:'casting',
    production_designer:'storyboard', prompt_writer:'storyboard', stills_prompt:'storyboard',
    prop_master:'wardrobe', costume_designer:'wardrobe',
    dp:'camera', camera_operator:'camera', gaffer:'camera', key_grip:'camera',
    location_scout:'backlot', stills:'stage-a', second_unit:'stage-b',
    colorist:'post', editor:'post', composer:'sound', taste:'taste'
  });

  const buildingById = Object.freeze(Object.fromEntries(buildings.map(building => [building.id, building])));
  const rolesByBuilding = Object.freeze(Object.entries(roleBuildings).reduce((out, [roleId, buildingId]) => {
    (out[buildingId] ||= []).push(roleId);
    return out;
  }, {}));

  function buildingForRole(roleId) {
    return buildingById[roleBuildings[roleId]] || buildingById.production;
  }

  function roleHome(roleId) {
    const building = buildingForRole(roleId);
    const roles = rolesByBuilding[building.id] || [];
    const index = Math.max(0, roles.indexOf(roleId));
    const slot = building.slots[index] || building.slots[building.slots.length - 1] || building.door;
    return { x:slot.x, y:slot.y, buildingId:building.id };
  }

  function routeBetween(fromRoleId, toRoleId) {
    const fromBuilding = buildingForRole(fromRoleId);
    const toBuilding = buildingForRole(toRoleId);
    const from = roleHome(fromRoleId);
    const to = roleHome(toRoleId);
    if (fromBuilding.id === toBuilding.id) return [from, to];
    return [from, fromBuilding.door, MAP.meetingPoint, toBuilding.door, to];
  }

  function pointInRect(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
  }

  root.StudioTownLayout = Object.freeze({
    map: MAP,
    buildings: Object.freeze(buildings),
    buildingById,
    roleBuildings,
    rolesByBuilding,
    buildingForRole,
    roleHome,
    routeBetween,
    pointInRect
  });
})(globalThis);
