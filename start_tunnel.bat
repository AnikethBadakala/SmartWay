@echo off
echo ====================================================================
echo  SmartWay: Public Internet Tunnel for Real-World iOS Driving
echo ====================================================================
echo.
echo Starting secure tunnel for port 8000...
echo.
echo NOTE: Copy the generated HTTPS URL and paste it in the SmartWay app settings!
echo.
npx localtunnel --port 8000
pause
