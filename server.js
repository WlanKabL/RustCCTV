const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const RustPlus = require("@liamcottle/rustplus.js");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static("public"));

const fpsInterval = 1000 / 10;

// Store user clients by their socket ID
const userClients = {};

// Create a RustPlus client for a specific camera
function createRustClient(ip, port, playerId, playerToken) {
    return new RustPlus(ip, port, playerId, playerToken);
}

// WebSocket connection handler
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Event to set the Rust+ connection for this user (general connection, if needed)
    socket.on("set_connection", async (data) => {
        const { ip, port, playerId, playerToken } = data;

        try {
            // Initialize an empty cameras array for the user if not already present
            if (!userClients[socket.id]) {
                console.log("Initialize UserClient for " + socket.id);
                userClients[socket.id] = {
                    rustPlusInstance: createRustClient(
                        ip,
                        port,
                        playerId,
                        playerToken
                    ),
                    cameras: [],
                };
            }

            // Notify the frontend that the connection was successful
            socket.emit("connection_status", { success: true });
        } catch (error) {
            // Send failure response to the client with proper error message
            console.error(
                "Connection error:",
                error?.error || JSON.stringify(error)
            );
            socket.emit("connection_status", {
                success: false,
                error: error.error || JSON.stringify(error),
            });
        }
    });

    // Event to fetch camera feed for this user's camera
    socket.on("fetch_camera_feed", async (data) => {
        const { cameraId, cameraIndex, ip, port, playerId, playerToken } = data;

        // Ensure the user has an initialized client entry
        const userClient = userClients[socket.id];
        if (!userClient) {
            socket.emit(`camera_feed_${cameraId}`, {
                hasSignal: false,
                error: "Rust+ client not initialized",
            });
            return;
        }

        // Check if this camera is already subscribed
        const existingCamera = userClient.cameras.find(
            (camera) => camera.camera.identifier === cameraId
        );
        if (existingCamera) {
            socket.emit(`camera_feed_${cameraId}`, {
                hasSignal: false,
                error: "camera_already_subscribed",
            });
            return;
        }

        try {
            // Create a separate Rust+ instance for this camera
            const cameraControllerInstance = createRustClient(
                ip,
                port,
                playerId,
                playerToken
            );

            // Function to subscribe to the camera with error handling
            const subscribeToCamera = async (camera) => {
                try {
                    await camera.subscribe().catch((error) => {
                        if (error && error.error === "player_online") {
                            socket.emit(`camera_feed_${cameraId}`, {
                                cameraId,
                                cameraIndex,
                                feed: null,
                                hasSignal: false,
                                error: "player_online",
                            });
                            return;
                        }
                        console.log(
                            "Subscribe error: " + JSON.stringify(error)
                        );
                        throw new Error(
                            `Error subscribing to camera: ${
                                error.error || JSON.stringify(error)
                            }`
                        );
                    });
                } catch (error) {
                    console.error(
                        `Failed to subscribe to camera ${cameraId}:`,
                        error.message || error
                    );
                    socket.emit(`camera_feed_${cameraId}`, {
                        hasSignal: false,
                        error: error.message || error,
                    });
                }
            };

            // Function to handle camera frames and resubscribe with an FPS limiter
            const handleCameraFrames = async (camera) => {
                try {
                    camera.on("render", async (frame) => {
                        const feed = `data:image/png;base64,${frame.toString(
                            "base64"
                        )}`;
                        socket.emit(`camera_feed_${cameraId}`, {
                            cameraId,
                            cameraIndex,
                            feed,
                            hasSignal: true,
                        });

                        // Unsubscribe after receiving a frame
                        await camera.unsubscribe();
                        // console.log(`Unsubscribed from camera ${cameraId}`);

                        // Wait for the FPS interval before subscribing again
                        setTimeout(
                            () => subscribeToCamera(camera),
                            fpsInterval
                        );
                    });

                    // Start with an initial subscription
                    await subscribeToCamera(camera);
                } catch (error) {
                    console.error(
                        `Failed to handle frames for camera ${cameraId}:`,
                        error.message || error
                    );
                    socket.emit(`camera_feed_${cameraId}`, {
                        hasSignal: false,
                        error: error.message || error,
                    });
                }
            };

            // Connect to Rust+ and handle camera frames
            await new Promise((resolve, reject) => {
                cameraControllerInstance.connect();

                cameraControllerInstance.on("connected", async () => {
                    console.log(
                        `Connected to Rust+ server for camera ${cameraId}`
                    );

                    // Subscribe to the camera feed
                    const camera = cameraControllerInstance.getCamera(cameraId);

                    // Handle camera frames with FPS control
                    await handleCameraFrames(camera);

                    // Add the camera to the user's list of cameras
                    userClient.cameras.push({
                        cameraControllerInstance,
                        camera: camera, // Store the actual camera instance
                    });

                    resolve();
                });

                cameraControllerInstance.on("error", (err) => {
                    console.error(
                        `Error connecting to Rust+ for camera ${cameraId}:`,
                        err
                    );
                    reject(err);
                });
            });
        } catch (error) {
            console.error(
                `Failed to fetch camera ${cameraId} for user ${socket.id}:`,
                error.message || error
            );
            socket.emit(`camera_feed_${cameraId}`, {
                hasSignal: false,
                error: error.message || error,
            });
        }
    });
    
    // Event to remove the camera feed for this user
    socket.on("remove_camera_feed", async (data) => {
        const { cameraId } = data;

        // Get the user client
        const userClient = userClients[socket.id];
        if (!userClient) {
            return;
        }

        // Find and remove the camera from the user's camera list
        const cameraIndex = userClient.cameras.findIndex(
            (camera) => camera.camera.identifier === cameraId
        );
        if (cameraIndex !== -1) {
            const cameraInstance = userClient.cameras[cameraIndex];

            try {
                // Unsubscribe and disconnect the camera
                cameraInstance.camera
                    .unsubscribe()
                    .then(() => {
                        console.log(
                            `Unsubscribed from camera ${cameraInstance.camera.identifier}`
                        );

                        // Remove the camera from the list
                        userClient.cameras.splice(cameraIndex, 1);

                        socket.emit(
                            `camera_feed_${cameraInstance.camera.identifier}`,
                            {
                                cameraId: cameraInstance.camera.identifier,
                                feed: null,
                                hasSignal: false,
                                error: "camera_removed",
                            }
                        );

                        //TODO: Waiting for https://github.com/liamcottle/rustplus.js/pull/70
                        // try {
                        //     cameraInstance.cameraControllerInstance.disconnect();
                        // } catch (error) {
                        //     console.log("Error disconnecting WebSocket:", error.message);
                        // }
                    })
                    .catch((error) => {
                        console.error(
                            `Error unsubscribing from camera ${cameraInstance.camera.identifier}:`,
                            error
                        );
                    });
            } catch (error) {
                console.error(
                    `Failed to remove camera ${cameraInstance.camera.identifier} for user ${socket.id}:`,
                    error.error || JSON.stringify(error)
                );
            }
        }
    });

    // Handle client disconnect and cleanup
    socket.on("disconnect", async () => {
        console.log(`Client disconnected: ${socket.id}`);

        // Get the Rust+ client for this user and disconnect all cameras
        const userClient = userClients[socket.id];
        if (userClient) {
            try {
                // Disconnect all camera instances for this user
                for (const camera of userClient.cameras) {
                    const cameraInstance = camera.camera;
                    cameraInstance
                        .unsubscribe()
                        .then(() => {
                            console.log(
                                `Unsubscribed from camera ${cameraInstance.identifier}`
                            );
                            socket.emit(
                                `camera_feed_${cameraInstance.identifier}`,
                                {
                                    cameraId: cameraInstance.identifier,
                                    feed: null,
                                    hasSignal: false,
                                    error: "camera_removed",
                                }
                            );
                        })
                        .catch((error) => {
                            console.error(
                                `Error unsubscribing from camera ${cameraInstance.identifier}:`,
                                error
                            );
                        });

                    //TODO: Waiting for https://github.com/liamcottle/rustplus.js/pull/70
                    // try {
                    //     camera.cameraControllerInstance.disconnect();
                    // } catch (error) {
                    //     console.log("Error disconnecting WebSocket:", error.message);
                    // }
                }

                //TODO: Waiting for https://github.com/liamcottle/rustplus.js/pull/70
                // userClient.rustPlusInstance.disconnect();

                // Clean up the user's client
                delete userClients[socket.id];
                console.log(`Cleaned up Rust+ client for user ${socket.id}`);
            } catch (error) {
                console.error(
                    `Error during cleanup for user ${socket.id}:`,
                    error.error || JSON.stringify(error)
                );
            }
        }
    });
});

// Start the server
const port = 6587;
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
