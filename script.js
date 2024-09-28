const RustPlus = require('@liamcottle/rustplus.js');

let rustPlus;

function connectToRustPlus() {
    const serverIp = document.getElementById('serverIp').value;
    const rustPort = parseInt(document.getElementById('rustPort').value);
    const playerId = document.getElementById('playerId').value;
    const playerToken = document.getElementById('playerToken').value;

    const cameraIds = [
        document.getElementById('camera1Id').value,
        document.getElementById('camera2Id').value,
        document.getElementById('camera3Id').value,
        document.getElementById('camera4Id').value
    ];

    // Save data to localStorage for persistence
    localStorage.setItem('serverIp', serverIp);
    localStorage.setItem('rustPort', rustPort);
    localStorage.setItem('playerId', playerId);
    localStorage.setItem('playerToken', playerToken);
    cameraIds.forEach((id, index) => {
        localStorage.setItem(`camera${index + 1}Id`, id);
    });

    // Initialize the RustPlus instance
    rustPlus = new RustPlus(serverIp, rustPort, playerId, playerToken);

    // Connect to the Rust+ server
    rustPlus.connect();

    rustPlus.on('connected', () => {
        console.log('Connected to Rust+');
        document.getElementById('status').textContent = 'Connected to Rust+';

        loadCameras(cameraIds);
    });

    rustPlus.on('error', (error) => {
        console.error('Rust+ connection error:', error);
        document.getElementById('status').textContent = 'Error: ' + error;
    });
}

function loadCameras(cameraIds) {
    cameraIds.forEach((cameraId, index) => {
        if (cameraId) {
            const cameraDiv = document.getElementById(`camera${index + 1}`);
            subscribeToCameraFeed(cameraId, cameraDiv);
        }
    });
}

function subscribeToCameraFeed(cameraId, cameraDiv) {
    const camera = rustPlus.getCamera(cameraId);

    camera.on('render', (frame) => {
        const feed = `data:image/png;base64,${frame.toString('base64')}`;
        cameraDiv.innerHTML = `<img src="${feed}" alt="Camera Feed" style="width: 100%; height: 100%;">`;
    });

    camera.subscribe().catch((error) => {
        console.error(`Error subscribing to camera ${cameraId}:`, error);
        cameraDiv.textContent = 'No Signal';
    });
}

// Make the connectToRustPlus function accessible from the global scope
window.connectToRustPlus = connectToRustPlus;
