# Install EAS CLI globally if not already installed
npm install -g eas-cli

# Login to Expo (this will prompt for your Expo credentials)
eas login

# Start the iOS build process (this will prompt for your Apple Developer credentials)
eas build -p ios
