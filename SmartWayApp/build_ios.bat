@echo off
echo Installing EAS CLI...
call npm install -g eas-cli

echo Logging into Expo...
call eas login

echo Starting iOS Build...
call eas build -p ios
pause
