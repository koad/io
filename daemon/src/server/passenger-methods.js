// Auto-detect passengers from koad:io entities with passenger.json files

const Passengers = new Mongo.Collection('Passengers', {connection: null});

// Detect koad:io entities - folders with .env containing KOAD_IO_* variables
function isKoadIOEntity(folderName) {
  const entityPath = process.env.HOME + '/' + folderName;
  const envPath = entityPath + '/.env';
  
  try {
    const fs = Npm.require('fs');
    const envContent = fs.readFileSync(envPath, 'utf8');
    return envContent.includes('KOAD_IO_');
  } catch (e) {
    return false;
  }
}

// Get list of koad:io entities from home directory
function getKoadIOEntities() {
  const homePath = process.env.HOME;
  const entities = [];
  
  try {
    const fs = Npm.require('fs');
    const folders = fs.readdirSync(homePath);
    
    for (const folder of folders) {
      if (folder.startsWith('.') && isKoadIOEntity(folder)) {
        entities.push(folder);
      }
    }
  } catch (e) {
    console.error('Error reading home directory:', e);
  }
  
  return entities;
}

// Load passenger.json from an entity folder and embed avatar
function loadPassengerConfig(entityName) {
  const entityPath = process.env.HOME + '/' + entityName;
  const passengerJsonPath = entityPath + '/passenger.json';
  const avatarPath = entityPath + '/avatar.png';
  
  try {
    const fs = Npm.require('fs');
    const content = fs.readFileSync(passengerJsonPath, 'utf8');
    const config = JSON.parse(content);
    console.log(`[PASSENGERS] Found passenger.json for ${entityName}`);
    
    // Check if avatar needs to be embedded
    if (config.avatar && !config.avatar.startsWith('data:')) {
      console.log(`[PASSENGERS] Attempting to embed avatar for ${entityName} from ${avatarPath}`);
      try {
        // Read avatar image and convert to base64
        const imageBuffer = fs.readFileSync(avatarPath);
        const base64Image = imageBuffer.toString('base64');
        
        // Create data URL
        config.avatar = `data:image/png;base64,${base64Image}`;
        console.log(`[PASSENGERS] ✓ Embedded avatar for ${entityName} (${imageBuffer.length} bytes)`);
      } catch (e) {
        console.warn(`[PASSENGERS] Could not embed avatar for ${entityName}:`, e.message);
        // Fallback to file path if embedding fails
        config.avatar = `/${entityName}/avatar.png`;
      }
    }
    
    return config;
  } catch (e) {
    // No passenger.json file - not a passenger entity
    console.log(`[PASSENGERS] No passenger.json for ${entityName}:`, e.message);
    return null;
  }
}

// Auto-detect and register passengers from entity folders
function registerPassengers() {
  console.log('[PASSENGERS] Starting passenger registration...');
  const entities = getKoadIOEntities();
  console.log('[PASSENGERS] Found entities:', entities);
  
  for (const entity of entities) {
    console.log(`[PASSENGERS] Checking entity: ${entity}`);
    const config = loadPassengerConfig(entity);
    
    if (config) {
      console.log(`[PASSENGERS] Loaded config for ${entity}:`, config.handle);
      // Check if already registered
      const existing = Passengers.findOne({ handle: config.handle });
      
      if (!existing) {
        Passengers.insert({
          handle: config.handle,
          name: config.name,
          image: config.avatar || `/${config.handle}/avatar.png`,
          outfit: config.outfit || generateDefaultOutfit(config.handle),
          buttons: config.buttons || []
        });
        console.log(`[PASSENGERS] ✓ Registered passenger: ${config.name}`);
      } else {
        console.log(`[PASSENGERS] Passenger ${config.name} already registered`);
      }
    } else {
      console.log(`[PASSENGERS] No passenger.json found for ${entity}`);
    }
  }
  
  const totalPassengers = Passengers.find().count();
  console.log(`[PASSENGERS] Registration complete. Total passengers: ${totalPassengers}`);
}

// Generate default outfit from entity name hash
function generateDefaultOutfit(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return {
    hue: Math.abs(hash % 360),
    saturation: 30 + (Math.abs(hash) % 50),
    brightness: 20 + (Math.abs(hash) % 30)
  };
}

// Register passengers on startup
Meteor.startup(() => {
  console.log('[PASSENGERS] Meteor.startup() called');
  registerPassengers();
});

Meteor.methods({
  'passenger.check.in'(passengerName) {
    check(passengerName, String);
    const passenger = Passengers.findOne({ name: passengerName });
    if (!passenger) return Meteor.Error('not-found', 'Passenger not found');
    
    Passengers.update({}, { $unset: { selected: '' } }, { multi: true });
    Passengers.update(passenger._id, {$set: {selected: new Date()}});
    return { _id: passenger._id };
  },
  
  'passenger.ingest.url'(data) {
    check(data, {
      url: String,
      title: String,
      timestamp: String,
      domain: String,
      favicon: Match.Optional(String)
    });
    
    const passenger = Passengers.findOne({ selected: { $exists: 1 } });
    if (!passenger) return { success: false, reason: 'No passenger selected' };
    
    console.log(`[INGEST] ${passenger.name} received URL: ${data.url}`);
    return { success: true, passenger: passenger.name };
  },
  
  'passenger.resolve.identity'(data) {
    check(data, {
      domain: String,
      url: Match.Optional(String)
    });
    
    const passenger = Passengers.findOne({ selected: { $exists: 1 } });
    if (!passenger) return { found: false, reason: 'No passenger selected' };
    
    console.log(`[IDENTITY] ${passenger.name} resolving: ${data.domain}`);
    
    return {
      found: false,
      message: 'Identity resolution not implemented'
    };
  },
  
  'passenger.check.url'(data) {
    check(data, {
      domain: String,
      url: Match.Optional(String)
    });
    
    const passenger = Passengers.findOne({ selected: { $exists: 1 } });
    if (!passenger) return { warning: false, safe: true };
    
    console.log(`[CHECK] ${passenger.name} checking: ${data.domain}`);
    
    return {
      warning: false,
      safe: true,
      message: 'URL check not implemented'
    };
  },
  
  'passenger.reload'() {
    // Force re-scan of passengers
    Passengers.remove({});
    registerPassengers();
    return { success: true };
  }
});

Meteor.publish('current', function() {
   return Passengers.find({selected: { $exists: 1}}, {sort: {selected: 1}});
});

Meteor.publish('all', function() {
   return Passengers.find();
});
