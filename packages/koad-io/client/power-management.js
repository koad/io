if ('getBattery' in navigator) {
  navigator.getBattery().then(battery => {
    // If battery is charging or battery level is high enough
    if (battery.charging || battery.level > 0.15) {
      koad.powersaver = false;
    } else {
      koad.powersaver = true;
    };
  });
}

if ('connection' in navigator) {
  if (navigator.connection.type == 'cellular') {
    koad.datasaver = true;
  } else {
    koad.datasaver = false;
  }
}
