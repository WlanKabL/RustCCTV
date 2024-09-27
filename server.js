const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const RustPlus = require('@liamcottle/rustplus.js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let rustplus = null;
let isConnected = false;  // Flag to check if the connection is successful
const cameraSubscriptions = {};  // Store camera subscriptions

function initializeRustClient(ip, port, playerId, playerToken) {
    rustplus = new RustPlus(ip, port, playerId, playerToken);
}

// Listen for WebSocket connections
io.on('connection', (socket) => {
    console.log('Client connected');

    // Event to set the connection settings
    socket.on('set_connection', async (data) => {
        const { ip, port, playerId, playerToken } = data;
        try {
            initializeRustClient(ip, port, playerId, playerToken);

            // Connect to Rust server
            await new Promise((resolve, reject) => {
                rustplus.connect();

                rustplus.on('connected', () => {
                    console.log('Connected to Rust+ server');
                    isConnected = true; // Mark connection as successful
                    resolve();
                });

                rustplus.on('error', (err) => {
                    console.error('Error connecting to Rust+ server:', err);
                    isConnected = false;
                    reject(new Error(`Connection error: ${err.message || err}`));
                });
            });

            // Send success response to the client
            socket.emit('connection_status', { success: true });

        } catch (error) {
            // Send failure response to the client with proper error message
            console.error('Connection error:', error?.message || JSON.stringify(error));
            socket.emit('connection_status', { success: false, error: error.error || error });
        }
    });

    // Event to fetch camera feed
    socket.on('fetch_camera_feed', async (data) => {
        const { cameraId, cameraIndex } = data;

        try {
            console.log("Subscribing to:" + cameraId)
            // Check if Rust client is connected
            if (!isConnected) {
                throw new Error('Rust+ client is not connected');
            }

            // If already subscribed to the camera, don't re-subscribe
            if (cameraSubscriptions[cameraId] && cameraSubscriptions[cameraId].isSubscribed) {
                cameraSubscriptions[cameraId]
                return socket.emit(`camera_feed_${cameraId}`, { cameraId, hasSignal: false, error: "camera_already_subscribed" });
            }

            // Subscribe to camera
            const camera = rustplus.getCamera(cameraId);
            cameraSubscriptions[cameraId] = camera;  // Store the camera subscription

            // Listen for camera render event
            camera.on('render', async (frame) => {
                // Send camera feed as base64 PNG
                const feed = `data:image/png;base64,${frame.toString('base64')}`;
                socket.emit(`camera_feed_${cameraId}`, { cameraId, cameraIndex, feed, hasSignal: true });

                // Optionally save to disk (for demonstration)
                // fs.writeFileSync(`camera${cameraIndex}.png`, frame);
            });

            // Subscribe to the camera feed
            await camera.subscribe().catch((error) => {
                if (error && error.error == "player_online") {
                    socket.emit(`camera_feed_${cameraId}`, { cameraId, cameraIndex, feed: null, hasSignal: false, error: "player_online" });
                    return;
                }
                console.log("Subscribe error: " + JSON.stringify(error))
                throw new Error(`Error subscribing to camera: ${error.error || JSON.stringify(error) }`);
            });

            camera.on('error', (error) => {
                console.error(`Error with camera ${cameraId}:`, JSON.stringify(error));
                socket.emit(`camera_feed_${cameraId}`, { cameraId, cameraIndex, feed: null, hasSignal: false, error: error?.error || error });
            });

        } catch (error) {
            console.error(`Failed to fetch camera ${cameraId}:`, error.message || JSON.stringify(error));
            socket.emit(`camera_feed_${cameraId}`, { cameraId, cameraIndex, feed: null, hasSignal: false, error: error?.error || error });
        }
    });

    // Event to remove camera feed subscription
    socket.on('remove_camera_feed', (data) => {
        const { cameraId } = data;

        // If camera is subscribed, unsubscribe and clean up
        if (cameraSubscriptions[cameraId]) {
            const camera = cameraSubscriptions[cameraId];
            camera.unsubscribe().then(() => {
                console.log(`Unsubscribed from camera ${cameraId}`);
                delete cameraSubscriptions[cameraId];
                socket.emit(`camera_feed_${cameraId}`, { cameraId, feed: null, hasSignal: false, error: "camera_removed" });
            }).catch((error) => {
                console.error(`Error unsubscribing from camera ${cameraId}:`, error);
            });
        } else {
            console.log(`Camera ${cameraId} was not subscribed`);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        isConnected = false;  // Mark connection as disconnected

        // Unsubscribe from all cameras when client disconnects
        for (const cameraId in cameraSubscriptions) {
            const camera = cameraSubscriptions[cameraId];
            camera.unsubscribe().then(() => {
                console.log(`Unsubscribed from camera ${cameraId} on disconnect`);
            }).catch((error) => {
                console.error(`Error unsubscribing from camera ${cameraId} on disconnect:`, error);
            });
        }
    });
});

// Start the server
const port = 3000;
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
