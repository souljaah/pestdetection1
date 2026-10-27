Create a modern, professional, responsive web-based monitoring dashboard for an embedded smart agriculture system that detects pests using cameras and automatically activates a pesticide sprayer.

The system monitors FOUR crop zones. The dashboard should connect to an embedded device/camera system and display real-time monitoring information, pest detection records, spray activation logs, camera status, and historical data.

SYSTEM PURPOSE:
The system uses camera modules to monitor four crop zones. When a pest is detected, the system identifies the pest class, calculates a detection confidence score, records the date and time, and can activate a spray mechanism for the affected crop zone.

DESIGN STYLE:
- Professional agricultural technology / smart farming interface
- Modern IoT monitoring dashboard
- Clean and organized layout
- Dark green, forest green, white, and subtle gray color palette
- Use red/orange only for warnings, detected pests, or active spraying
- Responsive design for desktop, tablet, and mobile
- Use cards, tables, charts, status indicators, icons, and clear typography
- The interface should look like a real operational monitoring system, not a generic admin template
- Prioritize readability and real-time system information

MAIN LAYOUT:

1. SIDEBAR NAVIGATION

Create a fixed sidebar containing:

- System Logo / Name
  "SMART CROP MONITORING SYSTEM"

Navigation:
- Dashboard
- Live Monitoring
- Detection Logs
- Spray Logs
- History
- Camera Status
- System Settings

At the bottom:
- System Online indicator
- Current date and time
- User/Admin profile

On mobile, convert the sidebar into a collapsible navigation menu.

--------------------------------------------------

2. DASHBOARD / OVERVIEW PAGE

Create an overview dashboard showing the current condition of the entire system.

At the top display:

"SMART CROP MONITORING SYSTEM"

Subtitle:
"Real-Time Pest Detection & Automated Crop Protection"

Show four summary cards:

TOTAL CROP ZONES
4 Zones

ACTIVE DETECTIONS
Display the current number of detected pests.

SPRAY STATUS
Show:
"READY"
or
"SPRAYING"

SYSTEM STATUS
Show:
"ONLINE"
with a green status indicator.

Below the summary cards, display a REAL-TIME CROP ZONE MONITOR.

Create four zone cards:

ZONE 1
Camera status: Online
Detection status: No Pest Detected
Spray status: Ready

ZONE 2
Camera status: Online
Detection status: Pest Detected
Spray status: Spraying

ZONE 3
Camera status: Online
Detection status: No Pest Detected
Spray status: Ready

ZONE 4
Camera status: Offline
Detection status: Unknown
Spray status: Disabled

Each zone should have:
- Camera preview
- Zone number
- Camera connection status
- Current pest detection
- Confidence score
- Spray status
- Last detection time

Use visual status indicators:
Green = Normal / Online
Yellow = Warning
Red = Pest Detected / Spraying / Error
Gray = Offline

--------------------------------------------------

3. LIVE MONITORING PAGE

Create a dedicated page called:

"LIVE MONITORING"

Display four real-time camera feeds arranged in a 2x2 grid on desktop.

Each camera panel should display:

ZONE 1
CAMERA 01

[REAL-TIME CAMERA FEED]

Below the feed:

Camera Status: ONLINE
Detection: None
Confidence: 0%
Spray: READY
Last Updated: 12:30:15 PM

Repeat for Zones 2, 3, and 4.

When a pest is detected, visually highlight the camera feed and show:

PEST DETECTED

Pest Class:
[Example: Aphid]

Confidence:
94.7%

Detection Time:
12:32:41 PM

Spray:
ACTIVE

Add a bounding box overlay around detected pests in the camera preview.

--------------------------------------------------

4. DETECTION LOGS PAGE

Create a searchable detection-record table.

Title:

"PEST DETECTION LOGS"

Table columns:

ID
Crop Zone
Camera
Pest Class
Confidence
Date
Time
Status

Example:

001 | Zone 1 | Camera 01 | Aphid | 94.7% | 09/21/2026 | 10:32 AM | Confirmed

002 | Zone 3 | Camera 03 | Caterpillar | 91.2% | 09/21/2026 | 10:41 AM | Confirmed

Features:
- Search detection records
- Filter by crop zone
- Filter by pest class
- Filter by date
- Sort by confidence
- Pagination
- View detection details

--------------------------------------------------

5. SPRAY LOGS PAGE

Create a page for all automated spray activations.

Title:

"SPRAY ACTIVATION LOGS"

Display a table:

ID
Crop Zone
Trigger
Spray Duration
Activation Date
Activation Time
Status

Example:

001 | Zone 2 | Aphid Detected | 5 sec | 09/21/2026 | 10:32 AM | Completed

002 | Zone 3 | Caterpillar Detected | 7 sec | 09/21/2026 | 10:41 AM | Completed

Use status indicators:

ACTIVE
COMPLETED
FAILED
CANCELLED

Include a summary section:

Total Spray Activations
Today's Activations
Total Spray Duration
Currently Spraying

--------------------------------------------------

6. HISTORY PAGE

Create a searchable historical monitoring page.

Title:

"HISTORICAL MONITORING"

Allow the user to:

- Select date range
- Select crop zone
- Select pest type
- Select event type
- Search records

Display charts showing:

Pest detections over time
Spray activations over time
Detections by crop zone
Most frequently detected pests

Use line charts and bar charts.

Include a timeline of historical events.

Example:

10:32 AM
Zone 2
Aphid detected
94.7% confidence

10:32 AM
Zone 2
Sprayer activated
5 seconds

10:37 AM
Zone 2
Spraying completed

--------------------------------------------------

7. CAMERA STATUS PAGE

Create a dedicated camera-management page.

Title:

"CAMERA STATUS"

Display four camera cards:

CAMERA 01
Zone 1
ONLINE
Signal: Strong
Last Update: 2 seconds ago

CAMERA 02
Zone 2
ONLINE
Signal: Strong
Last Update: 1 second ago

CAMERA 03
Zone 3
ONLINE
Signal: Medium
Last Update: 3 seconds ago

CAMERA 04
Zone 4
OFFLINE
Signal: None
Last Update: 5 minutes ago

Each camera should display:
- Connection status
- Signal strength
- Last communication
- Camera IP/device identifier
- Frame rate
- Resolution
- Reconnect button

If a camera becomes disconnected, display a warning notification.

--------------------------------------------------

8. SYSTEM STATUS

Add a system health section showing:

Embedded Controller
ONLINE

Camera Modules
3 / 4 ONLINE

Pest Detection Model
RUNNING

Spray Controller
READY

Database
CONNECTED

Network
CONNECTED

Use green check icons for normal components and red warning icons for failures.

--------------------------------------------------

9. REAL-TIME ALERTS

Create a notification panel.

Examples:

🔴 PEST DETECTED
Zone 2 detected Aphid
Confidence: 94.7%

🟠 SPRAY ACTIVATED
Zone 2 sprayer activated for 5 seconds.

🟢 SPRAY COMPLETED
Zone 2 spraying completed successfully.

🔴 CAMERA OFFLINE
Camera 04 has disconnected.

Alerts should update dynamically.

--------------------------------------------------

10. HEADER

Create a top navigation/header containing:

SMART CROP MONITORING SYSTEM

Live System Status:
● SYSTEM ONLINE

Current Date:
September 21, 2026

Current Time:
12:32 PM

Notification icon
User/Admin profile

--------------------------------------------------

11. EMBEDDED SYSTEM INTEGRATION

Design the frontend so it can later communicate with the embedded system through an API.

Prepare the application for endpoints such as:

GET /api/cameras
GET /api/detections
GET /api/sprays
GET /api/history
GET /api/system-status

For real-time updates, structure the application so WebSocket or MQTT communication can later be integrated.

The dashboard should be able to receive:

- Camera frames
- Pest detection results
- Pest class
- Confidence score
- Crop zone
- Detection timestamp
- Spray activation status
- Spray duration
- Camera connection status
- Embedded controller status

Do NOT use fake functionality for actual hardware control. Clearly separate demonstration/mock data from the future API integration.

--------------------------------------------------

12. RESPONSIVE DESIGN

Desktop:
Use a sidebar + main dashboard layout.

Tablet:
Collapse the sidebar and use a compact navigation.

Mobile:
Use a hamburger menu.

Camera feeds should stack vertically on mobile.

Tables should become horizontally scrollable cards or responsive list views.

Do not allow text, cards, tables, or navigation elements to overlap.

--------------------------------------------------

13. VISUAL DETAILS

Use:
- Rounded cards
- Subtle shadows
- Clean borders
- Green status indicators
- Red pest alerts
- Orange spray warnings
- Smooth hover effects
- Real-time status animations
- Professional icons
- Modern charts
- Clear spacing

The dashboard should feel like a real agricultural IoT control center used by farmers, researchers, or system administrators.

IMPORTANT:
The primary focus is REAL-TIME MONITORING.

The user should immediately understand:
1. What is happening in each of the four crop zones.
2. Whether a pest has been detected.
3. What pest was detected.
4. How confident the detection is.
5. Whether spraying is active.
6. Whether the cameras are connected.
7. What happened historically.

Build the interface as a functional web application with realistic sample data initially, while keeping the architecture ready for integration with the actual embedded hardware.