
#### YouTube Preview Button Shim

This shim adds a custom button to each YouTube video preview. Upon clicking this button, an animation is triggered, and a message is sent to the background worker, which then communicates with the koad:io daemon. This interaction is customizable through preferences set via the system tray icon of the koad:io desktop application.

#### Features

- **Custom Button on Video Previews**: Enhances YouTube video previews with a clickable button that features a custom image.
- **Animated Button Click**: Implements an animation effect on the button when clicked, providing visual feedback to the user.
- **Background Worker Communication**: On button click, the shim sends a message to the background worker, which in turn communicates with the koad:io daemon based on the current user preferences.
- **Customizable Actions**: The action taken upon clicking the button can be customized through the system tray application, allowing for a flexible integration with the koad:io ecosystem.

#### Development Notes

- The button's click event is captured by the content script and relayed to the background script. This indirection is necessary due to the content script's isolated environment, which cannot directly invoke browser-specific features like opening popups or communicating with external daemons.
- The animation effect on the button is purely for user feedback and does not affect the functionality of the message passing to the background worker and the koad:io daemon.

