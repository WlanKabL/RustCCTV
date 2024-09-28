# Rust+ CCTV Server

This project allows you to set up a Rust+ CCTV server to monitor cameras on your Rust server using the Rust+ API. It works by connecting your mobile-paired Rust+ account to a web-based interface, allowing you to view live camera feeds from your server.

## Features
- View live Rust+ camera feeds via a web interface.
- Supports multiple Rust+ camera subscriptions.
- Handles WebSocket connections with the Rust+ API efficiently.
- **LocalStorage** support to persist user connection details and camera configurations across sessions.
- **Multiple Camera Support**: View and manage up to **4 cameras simultaneously**, which is typically not possible through standard Rust+ implementations.
- **Auto-Subscribe/Unsubscribe Mechanism**: Automatically subscribes to cameras when added and unsubscribes when removed to optimize performance and ensure resources are managed efficiently.
- **Error Handling & Reconnect Logic**: Automatically handle connection issues and reconnect to Rust+ cameras when necessary.
- **Connection Status Display**: Visual indicators for connection status to the Rust+ server.
- **Responsive Design**: Optimized for different screen sizes, including mobile devices.
- **Docker Support**: Easily deploy the server using Docker.
- **Browser-Tab Isolation**: Ensure that multiple browser tabs can handle separate connections without interference.

## Setup

### Rust Server Configuration
To avoid connection limits and the HTTP error issue, it's recommended to adjust the following settings on your Rust server:

- **app.maxconnections = 10000**
- **app.maxconnectionsperip = 1000**

These changes prevent your server from hitting connection limits that might cause crashes.

### How to Pair and Get User Token

Follow the Rust+ pairing guide provided by Liam Cottle's [RustPlus.js documentation](https://github.com/liamcottle/rustplus.js?tab=readme-ov-file#pairing) or refer to the [PairingFlow.md](https://github.com/liamcottle/rustplus.js/blob/master/docs/PairingFlow.md) for detailed instructions. Here's a shorter version for convenience:

1. **Unpair and Repair**: Unpair your Rust+ mobile device from your server and then re-pair it after performing the following steps.
2. **Run the following commands**:
   ```bash
   npx @liamcottle/rustplus.js fcm-register
   npx @liamcottle/rustplus.js fcm-listen
   ```
   Follow the instructions in the `RustPlus.js` README to complete the pairing process and obtain your `token`.

### Web Interface Authentication
Once you have your Rust+ token, you can log in to the web interface with the following details:

- **ServerIP**: The IP of your Rust server.
- **ServerPort**: The larger value between your Rust server's RCON port and Rust+ port. The Rust+ port is typically `RCONPort + 67`.
- **SteamID**: The Steam ID from your Rust+ Steam account.
- **Token**: The token you obtained from the pairing process.

Once connected, simply provide the Camera ID, and the camera feed will load in the interface.

### LocalStorage Feature
This application utilizes **LocalStorage** to persist user connection details and camera configurations across sessions. The following data is stored in LocalStorage:

- **Server IP**
- **Server Port**
- **Steam ID**
- **Token**
- **Camera IDs**

This allows users to seamlessly reconnect to their Rust+ server without re-entering their details. Additionally, camera configurations are saved, so you can continue viewing previously configured cameras without having to manually input the IDs again.

To update or clear stored data, you can modify or remove these fields directly in the browser's LocalStorage or through the web interface.

## Server Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/WlanKabL/RustCCTV.git
   cd RustCCTV
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the server:
   ```bash
   node server.js
   ```

4. Alternatively, you can also run the project in Docker if you prefer containerization.

## Additional Notes
- The application can be configured to handle multiple Rust+ connections by adjusting the connection settings and managing Rust+ camera streams effectively.
- Make sure your Rust+ mobile app is properly paired and your server's ports are correctly configured.

Enjoy seamless CCTV integration for your Rust+ server!
