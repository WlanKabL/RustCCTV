(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

const { EventEmitter } = require("events");
const Jimp = require("jimp");

class Camera extends EventEmitter {

    /**
     * These represent the possible buttons that can be sent to the server.
     */
    static Buttons = {
        NONE: 0,
        FORWARD: 2,
        BACKWARD: 4,
        LEFT: 8,
        RIGHT: 16,
        JUMP: 32,
        DUCK: 64,
        SPRINT: 128,
        USE: 256,
        FIRE_PRIMARY: 1024,
        FIRE_SECONDARY: 2048,
        RELOAD: 8192,
        FIRE_THIRD: 134217728,
    }

    /**
     * These represent the possible control flags that can be sent to the server.
     * For example, Static CCTV cameras will not support movement.
     */
    static ControlFlags = {
        NONE: 0,
        MOVEMENT: 1,
        MOUSE: 2,
        SPRINT_AND_DUCK: 4,
        FIRE: 8,
        RELOAD: 16,
        CROSSHAIR: 32,
    }

    /**
     * @param rustplus An existing RustPlus instance
     * @param identifier Camera Identifier, such as OILRIG1 (or custom name)
     *
     * Events emitted by the Camera class instance
     * - subscribing: When we are subscribing to the Camera.
     * - subscribed: When we are subscribed to the Camera.
     * - unsubscribing: When we are unsubscribing from the Camera.
     * - unsubscribed: When we are unsubscribed from the Camera.
     * - render: When a camera frame has been rendered. A png image buffer will be provided.
     */
    constructor(rustplus, identifier) {

        super();

        this.rustplus = rustplus;
        this.identifier = identifier;
        this.isSubscribed = false;

        this.cameraRays = [];
        this.cameraSubscribeInfo = null;
        this.subscribeInterval = null;

        // listen to camera message broadcasts
        this.rustplus.on('message', async (message) => {
            await this._onMessage(message);
        });

        // unsubscribe when rustplus is disconnected (to prevent hanging due to intervals still running)
        this.rustplus.on('disconnected', async () => {
            if(this.isSubscribed){
                await this.unsubscribe();
            }
        });

    }

    async _onMessage(message) {

        // do nothing if not subscribed
        if(!this.isSubscribed){
            return;
        }

        if(message.broadcast && message.broadcast.cameraRays){
            await this._onCameraRays(message.broadcast.cameraRays);
        }

    }

    async _onCameraRays(cameraRays) {

        // do nothing if not subscribed
        if(!this.isSubscribed){
            return;
        }

        // add new camera rays to cache
        this.cameraRays.push(cameraRays);

        // wait until we have enough camera rays to render an image
        if(this.cameraRays.length > 10){

            // remove first oldest rayData
            this.cameraRays.shift();

            // render to png
            const frame = await this._renderCameraFrame(this.cameraRays, this.cameraSubscribeInfo.width, this.cameraSubscribeInfo.height);

            // fire callback
            await this._onRender(frame);

        }

    }

    async _onRender(image) {

        // do nothing if not subscribed
        if(!this.isSubscribed){
            return;
        }

        this.emit('render', image);

    }

    /**
     * Render a camera frame to a PNG image buffer
     * @param frames the frame data to render. This will be an array of camera rays from the server.
     * @param width the width of the frame
     * @param height the height of the frame
     */
    async _renderCameraFrame(frames, width, height) {

        // First we populate the samplePositionBuffer with the positions of each sample
        const samplePositionBuffer = new Int16Array(width * height * 2);
        for (let w = 0, _ = 0; _ < height; _++)
            for (let g = 0; g < width; g++) {
                samplePositionBuffer[w] = g;
                samplePositionBuffer[++w] = _;
                w++;
            }

        for (let B = new IndexGenerator(1337), R = width * height - 1; R >= 1; R--) {
            let C = 2 * R,
                I = 2 * B.nextInt(R + 1),
                P = samplePositionBuffer[C],
                k = samplePositionBuffer[C + 1],
                A = samplePositionBuffer[I],
                F = samplePositionBuffer[I + 1];
            samplePositionBuffer[I] = P;
            samplePositionBuffer[I + 1] = k;
            samplePositionBuffer[C] = A;
            samplePositionBuffer[C + 1] = F;
        }

        // Create the output buffer
        const output = new Array(width * height);
        // Loop through each frame
        for (let frame of frames) {

            // Reset some look back and pointer variables
            let sampleOffset = 2 * frame.sampleOffset;
            let dataPointer = 0;
            let rayLookback = new Array(64);
            for (let r = 0; r < 64; r++) rayLookback[r] = [0, 0, 0];

            const rayData = frame.rayData;

            // Loop through the ray data
            while (true) {
                if (dataPointer >= rayData.length - 1)
                    break;

                // Get the first byte and set some variables
                let t, r, i, n = rayData[dataPointer++];

                // Ray Decoding Logic
                if (255 === n) {
                    let l = rayData[dataPointer++],
                        o = rayData[dataPointer++],
                        s = rayData[dataPointer++],
                        u = (3 * (((t = (l << 2) | (o >> 6)) / 128) | 0) + 5 * (((r = 63 & o) / 16) | 0) + 7 * (i = s)) & 63,
                        f = rayLookback[u];
                    f[0] = t;
                    f[1] = r;
                    f[2] = i;
                } else {
                    let c = 192 & n;

                    if (0 === c) {
                        let h = 63 & n, y = rayLookback[h];
                        t = y[0];
                        r = y[1];
                        i = y[2];
                    } else if (64 === c) {
                        let p = 63 & n,
                            v = rayLookback[p],
                            b = v[0],
                            w = v[1],
                            _ = v[2],
                            g = rayData[dataPointer++];
                        t = b + ((g >> 3) - 15);
                        r = w + ((7 & g) - 3);
                        i = _;
                    } else if (128 === c) {
                        let R = 63 & n,
                            C = rayLookback[R],
                            I = C[0],
                            P = C[1],
                            k = C[2];
                        t = I + (rayData[dataPointer++] - 127);
                        r = P;
                        i = k;
                    } else {
                        let A = rayData[dataPointer++],
                            F = rayData[dataPointer++],
                            D = (3 * (((t = (A << 2) | (F >> 6)) / 128) | 0) + 5 * (((r = 63 & F) / 16) | 0) + 7 * (i = 63 & n)) & 63,
                            E = rayLookback[D];
                        E[0] = t;
                        E[1] = r;
                        E[2] = i;
                    }
                }

                sampleOffset %= 2 * width * height;
                const index = samplePositionBuffer[sampleOffset++] + samplePositionBuffer[sampleOffset++] * width;
                output[index] = [t / 1023, r / 63, i];
            }
        }

        const colours = [
            [0.5, 0.5, 0.5], [0.8, 0.7, 0.7], [0.3, 0.7, 1], [0.6, 0.6, 0.6],
            [0.7, 0.7, 0.7], [0.8, 0.6, 0.4], [1, 0.4, 0.4], [1, 0.1, 0.1],
        ];

        const image = new Jimp(width, height);

        for (let i = 0; i < output.length; i++) {
            let ray = output[i];
            if (!ray) {
                continue;
            }

            let distance = ray[0]
            let alignment = ray[1]
            let material = ray[2]

            let target_colour;

            if (distance === 1 && alignment === 0 && material === 0) {
                target_colour = [208, 230, 252];
            } else {
                let colour = colours[material];
                target_colour = [(alignment * colour[0] * 255), (alignment * colour[1] * 255), (alignment * colour[2] * 255)]
            }

            let x = i % width;
            let y = height - 1 - Math.floor(i / width);
            image.setPixelColor(Jimp.rgbaToInt(target_colour[0], target_colour[1], target_colour[2], 255), x, y);
        }

        // return png buffer
        return image.getBufferAsync(Jimp.MIME_PNG);

    }

    async _subscribe() {

        // subscribe to camera
        const response = await this.rustplus.sendRequestAsync({
            cameraSubscribe: {
                cameraId: this.identifier,
            },
        });

        // update camera subscribe info
        this.cameraSubscribeInfo = response.cameraSubscribeInfo;
        this.isSubscribed = true;

    }

    async subscribe() {

        this.emit('subscribing');

        // subscribe to camera
        await this._subscribe();

        this.emit('subscribed');

        // automatically resubscribe to the camera every 10 seconds
        this.subscribeInterval = setInterval(async () => {
            if(this.isSubscribed){
                await this._subscribe();
            }
        }, 10_000);

    }

    async unsubscribe() {

        this.emit('unsubscribing');

        this.isSubscribed = false;

        // stop automatically resubscribing
        clearInterval(this.subscribeInterval);

        // release memory
        this.cameraRays = [];
        this.cameraSubscribeInfo = null;
        this.subscribeInterval = null;

        // unsubscribe from camera on server (if connected)
        if(this.rustplus.isConnected()){
            try {
                await this.rustplus.sendRequestAsync({
                    cameraUnsubscribe: {

                    },
                });
            } catch (error) {
                // ignore errors unsubscribing from camera
            }
        }

        this.emit('unsubscribed');

    }

    /**
     * Sends camera movement to the server (mouse movement)
     * @param buttons The buttons that are currently pressed
     * @param x The x delta of the mouse movement
     * @param y The y delta of the mouse movement
     */
    async move(buttons, x, y) {
        return await this.rustplus.sendRequestAsync({
            cameraInput: {
                buttons: buttons,
                mouseDelta: {
                    x: x,
                    y: y,
                }
            },
        });
    }

    /**
     * Zooms a PTZ camera in by 1 level.
     * PTZ cameras have 4 zoom levels.
     * If the PTZ camera is already at max zoom (level 4), it zooms out as far as it can (level 1).
     */
    async zoom() {

        // press left mouse button to zoom in
        await this.move(Camera.Buttons.FIRE_PRIMARY, 0, 0);

        // release all mouse buttons
        await this.move(Camera.Buttons.NONE, 0, 0);

    }

    /**
     * Shoots a PTZ controllable Auto Turret.
     */
    async shoot() {

        // press left mouse button to shoot
        await this.move(Camera.Buttons.FIRE_PRIMARY, 0, 0);

        // release all mouse buttons
        await this.move(Camera.Buttons.NONE, 0, 0);

    }

    /**
     * Reloads a PTZ controllable Auto Turret
     */
    async reload() {

        // press reload button to reload turret
        await this.move(Camera.Buttons.RELOAD, 0, 0);

        // release all mouse buttons
        await this.move(Camera.Buttons.NONE, 0, 0);

    }

    /**
     * Check if camera is an auto turret
     * @returns {boolean}
     */
    isAutoTurret() {
        const crosshairControlFlag = Camera.ControlFlags.CROSSHAIR;
        return (this.cameraSubscribeInfo?.controlFlags & crosshairControlFlag) === crosshairControlFlag;
    }

}

class IndexGenerator {

    constructor(e) {
        this.state = 0 | e;
        this.nextState();
    }

    nextInt(e) {
        let t = ((this.nextState() * (0 | e)) / 4294967295) | 0;
        if (t < 0) t = e + t - 1;
        return 0 | t;
    }

    nextState() {
        let e = this.state, t = e;
        e = ((e = ((e = (e ^ ((e << 13) | 0)) | 0) ^ ((e >>> 17) | 0)) | 0) ^ ((e << 5) | 0)) | 0;
        this.state = e;
        return t >= 0 ? t : 4294967295 + t - 1;
    }

}

module.exports = Camera;
},{"events":13,"jimp":14}],2:[function(require,module,exports){
(function (__dirname){(function (){
"use strict";

const path = require('path');
const WebSocket = require('ws');
const protobuf = require("protobufjs");
const { EventEmitter } = require('events');
const Camera = require('./camera');

class RustPlus extends EventEmitter {

    /**
     * @param server The ip address or hostname of the Rust Server
     * @param port The port of the Rust Server (app.port in server.cfg)
     * @param playerId SteamId of the Player
     * @param playerToken Player Token from Server Pairing
     * @param useFacepunchProxy True to use secure websocket via Facepunch's proxy, or false to directly connect to Rust Server
     *
     * Events emitted by the RustPlus class instance
     * - connecting: When we are connecting to the Rust Server.
     * - connected: When we are connected to the Rust Server.
     * - message: When an AppMessage has been received from the Rust Server.
     * - request: When an AppRequest has been sent to the Rust Server.
     * - disconnected: When we are disconnected from the Rust Server.
     * - error: When something goes wrong.
     */
    constructor(server, port, playerId, playerToken, useFacepunchProxy = false) {

        super();

        this.server = server;
        this.port = port;
        this.playerId = playerId;
        this.playerToken = playerToken;
        this.useFacepunchProxy = useFacepunchProxy;

        this.seq = 0;
        this.seqCallbacks = [];

    }

    /**
     * This sets everything up and then connects to the Rust Server via WebSocket.
     */
    connect() {

        // load protobuf then connect
        protobuf.load(path.resolve(__dirname, "rustplus.proto")).then((root) => {

            // make sure existing connection is disconnected before connecting again.
            if(this.websocket){
                this.disconnect();
            }

            // load proto types
            this.AppRequest = root.lookupType("rustplus.AppRequest");
            this.AppMessage = root.lookupType("rustplus.AppMessage");

            // fire event as we are connecting
            this.emit('connecting');

            // connect to websocket
            var address = this.useFacepunchProxy ? `wss://companion-rust.facepunch.com/game/${this.server}/${this.port}` : `ws://${this.server}:${this.port}`;
            this.websocket = new WebSocket(address);

            // fire event when connected
            this.websocket.on('open', () => {
                this.emit('connected');
            });

            // fire event for websocket errors
            this.websocket.on('error', (e) => {
                this.emit('error', e);
            });

            this.websocket.on('message', (data) => {

                // decode received message
                var message = this.AppMessage.decode(data);

                // check if received message is a response and if we have a callback registered for it
                if(message.response && message.response.seq && this.seqCallbacks[message.response.seq]){

                    // get the callback for the response sequence
                    var callback = this.seqCallbacks[message.response.seq];

                    // call the callback with the response message
                    var result = callback(message);

                    // remove the callback
                    delete this.seqCallbacks[message.response.seq];

                    // if callback returns true, don't fire message event
                    if(result){
                        return;
                    }

                }

                // fire message event for received messages that aren't handled by callback
                this.emit('message', this.AppMessage.decode(data));

            });

            // fire event when disconnected
            this.websocket.on('close', () => {
                this.emit('disconnected');
            });

        });

    }

    /**
     * Disconnect from the Rust Server.
     */
    disconnect() {
        if(this.websocket){
            this.websocket.terminate();
            this.websocket = null;
        }
    }

    /**
     * Check if RustPlus is connected to the server.
     * @returns {boolean}
     */
    isConnected() {
        return (this.websocket.readyState === WebSocket.OPEN);
    }

    /**
     * Send a Request to the Rust Server with an optional callback when a Response is received.
     * @param data this should contain valid data for the AppRequest packet in the rustplus.proto schema file
     * @param callback
     */
    sendRequest(data, callback) {

        // increment sequence number
        let currentSeq = ++this.seq;

        // save callback if provided
        if(callback){
            this.seqCallbacks[currentSeq] = callback;
        }

        // create protobuf from AppRequest packet
        let request = this.AppRequest.fromObject({
            seq: currentSeq,
            playerId: this.playerId,
            playerToken: this.playerToken,
            ...data, // merge in provided data for AppRequest
        });

        // send AppRequest packet to rust server
        this.websocket.send(this.AppRequest.encode(request).finish());

        // fire event when request has been sent, this is useful for logging
        this.emit('request', request);

    }

    /**
     * Send a Request to the Rust Server and return a Promise
     * @param data this should contain valid data for the AppRequest packet defined in the rustplus.proto schema file
     * @param timeoutMilliseconds milliseconds before the promise will be rejected. Defaults to 10 seconds.
     */
    sendRequestAsync(data, timeoutMilliseconds = 10000) {
        return new Promise((resolve, reject) => {

            // reject promise after timeout
            var timeout = setTimeout(() => {
                reject(new Error('Timeout reached while waiting for response'));
            }, timeoutMilliseconds);

            // send request
            this.sendRequest(data, (message) => {

                // cancel timeout
                clearTimeout(timeout);

                if(message.response.error){

                    // reject promise if server returns an AppError for this request
                    reject(message.response.error);

                } else {

                    // request was successful, resolve with message.response
                    resolve(message.response);

                }

            });

        });
    }

    /**
     * Send a Request to the Rust Server to set the Entity Value.
     * @param entityId the entity id to set the value for
     * @param value the value to set on the entity
     * @param callback
     */
    setEntityValue(entityId, value, callback) {
        this.sendRequest({
            entityId: entityId,
            setEntityValue: {
                value: value,
            },
        }, callback);
    }

    /**
     * Turn a Smart Switch On
     * @param entityId the entity id of the smart switch to turn on
     * @param callback
     */
    turnSmartSwitchOn(entityId, callback) {
        this.setEntityValue(entityId, true, callback);
    }

    /**
     * Turn a Smart Switch Off
     * @param entityId the entity id of the smart switch to turn off
     * @param callback
     */
    turnSmartSwitchOff(entityId, callback) {
        this.setEntityValue(entityId, false, callback);
    }

    /**
     * Quickly turn on and off a Smart Switch as if it were a Strobe Light.
     * You will get rate limited by the Rust Server after a short period.
     * It was interesting to watch in game though 😝
     */
    strobe(entityId, timeoutMilliseconds = 100, value = true) {
        this.setEntityValue(entityId, value);
        setTimeout(() => {
            this.strobe(entityId, timeoutMilliseconds, !value);
        }, timeoutMilliseconds);
    }

    /**
     * Send a message to Team Chat
     * @param message the message to send to team chat
     * @param callback
     */
    sendTeamMessage(message, callback) {
        this.sendRequest({
            sendTeamMessage: {
                message: message,
            },
        }, callback);
    }

    /**
     * Get info for an Entity
     * @param entityId the id of the entity to get info of
     * @param callback
     */
    getEntityInfo(entityId, callback) {
        this.sendRequest({
            entityId: entityId,
            getEntityInfo: {

            },
        }, callback);
    }

    /**
     * Get the Map
     */
    getMap(callback) {
        this.sendRequest({
            getMap: {

            },
        }, callback);
    }
    
    /**
     * Get the ingame time
    */
    getTime(callback) {
        this.sendRequest({
            getTime: {

            },
        }, callback);
    }

    /**
     * Get all map markers
     */
    getMapMarkers(callback) {
        this.sendRequest({
            getMapMarkers: {

            },
        }, callback);
    }

    /**
     * Get the server info
     */
    getInfo(callback) {
        this.sendRequest({
            getInfo: {

            },
        }, callback);
    }

    /**
     * Get team info
     */
    getTeamInfo(callback) {
        this.sendRequest({
            getTeamInfo: {

            },
        }, callback);
    }

    /**
     * Subscribes to a Camera
     * @param identifier Camera Identifier, such as OILRIG1 (or custom name)
     * @param callback
     */
    subscribeToCamera(identifier, callback) {
        this.sendRequest({
            cameraSubscribe: {
                cameraId: identifier,
            },
        }, callback);
    }

    /**
     * Unsubscribes from a Camera
     * @param callback
     */
    unsubscribeFromCamera(callback) {
        this.sendRequest({
            cameraUnsubscribe: {

            }
        }, callback)
    }

    /**
     * Sends camera input to the server (mouse movement)
     * @param buttons The buttons that are currently pressed
     * @param x The x delta of the mouse movement
     * @param y The y delta of the mouse movement
     * @param callback
     */
    sendCameraInput(buttons, x, y, callback) {
        this.sendRequest({
            cameraInput: {
                buttons: buttons,
                mouseDelta: {
                    x: x,
                    y: y,
                }
            },
        }, callback);
    }

    /**
     * Get a camera instance for controlling CCTV Cameras, PTZ Cameras and  Auto Turrets
     * @param identifier Camera Identifier, such as DOME1, OILRIG1L1, (or a custom camera id)
     * @returns {Camera}
     */
    getCamera(identifier) {
        return new Camera(this, identifier);
    }

}

module.exports = RustPlus;

}).call(this)}).call(this,"/node_modules/@liamcottle/rustplus.js")
},{"./camera":1,"events":13,"path":15,"protobufjs":17,"ws":52}],3:[function(require,module,exports){
"use strict";
module.exports = asPromise;

/**
 * Callback as used by {@link util.asPromise}.
 * @typedef asPromiseCallback
 * @type {function}
 * @param {Error|null} error Error, if any
 * @param {...*} params Additional arguments
 * @returns {undefined}
 */

/**
 * Returns a promise from a node-style callback function.
 * @memberof util
 * @param {asPromiseCallback} fn Function to call
 * @param {*} ctx Function context
 * @param {...*} params Function arguments
 * @returns {Promise<*>} Promisified function
 */
function asPromise(fn, ctx/*, varargs */) {
    var params  = new Array(arguments.length - 1),
        offset  = 0,
        index   = 2,
        pending = true;
    while (index < arguments.length)
        params[offset++] = arguments[index++];
    return new Promise(function executor(resolve, reject) {
        params[offset] = function callback(err/*, varargs */) {
            if (pending) {
                pending = false;
                if (err)
                    reject(err);
                else {
                    var params = new Array(arguments.length - 1),
                        offset = 0;
                    while (offset < params.length)
                        params[offset++] = arguments[offset];
                    resolve.apply(null, params);
                }
            }
        };
        try {
            fn.apply(ctx || null, params);
        } catch (err) {
            if (pending) {
                pending = false;
                reject(err);
            }
        }
    });
}

},{}],4:[function(require,module,exports){
"use strict";

/**
 * A minimal base64 implementation for number arrays.
 * @memberof util
 * @namespace
 */
var base64 = exports;

/**
 * Calculates the byte length of a base64 encoded string.
 * @param {string} string Base64 encoded string
 * @returns {number} Byte length
 */
base64.length = function length(string) {
    var p = string.length;
    if (!p)
        return 0;
    var n = 0;
    while (--p % 4 > 1 && string.charAt(p) === "=")
        ++n;
    return Math.ceil(string.length * 3) / 4 - n;
};

// Base64 encoding table
var b64 = new Array(64);

// Base64 decoding table
var s64 = new Array(123);

// 65..90, 97..122, 48..57, 43, 47
for (var i = 0; i < 64;)
    s64[b64[i] = i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i - 59 | 43] = i++;

/**
 * Encodes a buffer to a base64 encoded string.
 * @param {Uint8Array} buffer Source buffer
 * @param {number} start Source start
 * @param {number} end Source end
 * @returns {string} Base64 encoded string
 */
base64.encode = function encode(buffer, start, end) {
    var parts = null,
        chunk = [];
    var i = 0, // output index
        j = 0, // goto index
        t;     // temporary
    while (start < end) {
        var b = buffer[start++];
        switch (j) {
            case 0:
                chunk[i++] = b64[b >> 2];
                t = (b & 3) << 4;
                j = 1;
                break;
            case 1:
                chunk[i++] = b64[t | b >> 4];
                t = (b & 15) << 2;
                j = 2;
                break;
            case 2:
                chunk[i++] = b64[t | b >> 6];
                chunk[i++] = b64[b & 63];
                j = 0;
                break;
        }
        if (i > 8191) {
            (parts || (parts = [])).push(String.fromCharCode.apply(String, chunk));
            i = 0;
        }
    }
    if (j) {
        chunk[i++] = b64[t];
        chunk[i++] = 61;
        if (j === 1)
            chunk[i++] = 61;
    }
    if (parts) {
        if (i)
            parts.push(String.fromCharCode.apply(String, chunk.slice(0, i)));
        return parts.join("");
    }
    return String.fromCharCode.apply(String, chunk.slice(0, i));
};

var invalidEncoding = "invalid encoding";

/**
 * Decodes a base64 encoded string to a buffer.
 * @param {string} string Source string
 * @param {Uint8Array} buffer Destination buffer
 * @param {number} offset Destination offset
 * @returns {number} Number of bytes written
 * @throws {Error} If encoding is invalid
 */
base64.decode = function decode(string, buffer, offset) {
    var start = offset;
    var j = 0, // goto index
        t;     // temporary
    for (var i = 0; i < string.length;) {
        var c = string.charCodeAt(i++);
        if (c === 61 && j > 1)
            break;
        if ((c = s64[c]) === undefined)
            throw Error(invalidEncoding);
        switch (j) {
            case 0:
                t = c;
                j = 1;
                break;
            case 1:
                buffer[offset++] = t << 2 | (c & 48) >> 4;
                t = c;
                j = 2;
                break;
            case 2:
                buffer[offset++] = (t & 15) << 4 | (c & 60) >> 2;
                t = c;
                j = 3;
                break;
            case 3:
                buffer[offset++] = (t & 3) << 6 | c;
                j = 0;
                break;
        }
    }
    if (j === 1)
        throw Error(invalidEncoding);
    return offset - start;
};

/**
 * Tests if the specified string appears to be base64 encoded.
 * @param {string} string String to test
 * @returns {boolean} `true` if probably base64 encoded, otherwise false
 */
base64.test = function test(string) {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(string);
};

},{}],5:[function(require,module,exports){
"use strict";
module.exports = codegen;

/**
 * Begins generating a function.
 * @memberof util
 * @param {string[]} functionParams Function parameter names
 * @param {string} [functionName] Function name if not anonymous
 * @returns {Codegen} Appender that appends code to the function's body
 */
function codegen(functionParams, functionName) {

    /* istanbul ignore if */
    if (typeof functionParams === "string") {
        functionName = functionParams;
        functionParams = undefined;
    }

    var body = [];

    /**
     * Appends code to the function's body or finishes generation.
     * @typedef Codegen
     * @type {function}
     * @param {string|Object.<string,*>} [formatStringOrScope] Format string or, to finish the function, an object of additional scope variables, if any
     * @param {...*} [formatParams] Format parameters
     * @returns {Codegen|Function} Itself or the generated function if finished
     * @throws {Error} If format parameter counts do not match
     */

    function Codegen(formatStringOrScope) {
        // note that explicit array handling below makes this ~50% faster

        // finish the function
        if (typeof formatStringOrScope !== "string") {
            var source = toString();
            if (codegen.verbose)
                console.log("codegen: " + source); // eslint-disable-line no-console
            source = "return " + source;
            if (formatStringOrScope) {
                var scopeKeys   = Object.keys(formatStringOrScope),
                    scopeParams = new Array(scopeKeys.length + 1),
                    scopeValues = new Array(scopeKeys.length),
                    scopeOffset = 0;
                while (scopeOffset < scopeKeys.length) {
                    scopeParams[scopeOffset] = scopeKeys[scopeOffset];
                    scopeValues[scopeOffset] = formatStringOrScope[scopeKeys[scopeOffset++]];
                }
                scopeParams[scopeOffset] = source;
                return Function.apply(null, scopeParams).apply(null, scopeValues); // eslint-disable-line no-new-func
            }
            return Function(source)(); // eslint-disable-line no-new-func
        }

        // otherwise append to body
        var formatParams = new Array(arguments.length - 1),
            formatOffset = 0;
        while (formatOffset < formatParams.length)
            formatParams[formatOffset] = arguments[++formatOffset];
        formatOffset = 0;
        formatStringOrScope = formatStringOrScope.replace(/%([%dfijs])/g, function replace($0, $1) {
            var value = formatParams[formatOffset++];
            switch ($1) {
                case "d": case "f": return String(Number(value));
                case "i": return String(Math.floor(value));
                case "j": return JSON.stringify(value);
                case "s": return String(value);
            }
            return "%";
        });
        if (formatOffset !== formatParams.length)
            throw Error("parameter count mismatch");
        body.push(formatStringOrScope);
        return Codegen;
    }

    function toString(functionNameOverride) {
        return "function " + (functionNameOverride || functionName || "") + "(" + (functionParams && functionParams.join(",") || "") + "){\n  " + body.join("\n  ") + "\n}";
    }

    Codegen.toString = toString;
    return Codegen;
}

/**
 * Begins generating a function.
 * @memberof util
 * @function codegen
 * @param {string} [functionName] Function name if not anonymous
 * @returns {Codegen} Appender that appends code to the function's body
 * @variation 2
 */

/**
 * When set to `true`, codegen will log generated code to console. Useful for debugging.
 * @name util.codegen.verbose
 * @type {boolean}
 */
codegen.verbose = false;

},{}],6:[function(require,module,exports){
"use strict";
module.exports = EventEmitter;

/**
 * Constructs a new event emitter instance.
 * @classdesc A minimal event emitter.
 * @memberof util
 * @constructor
 */
function EventEmitter() {

    /**
     * Registered listeners.
     * @type {Object.<string,*>}
     * @private
     */
    this._listeners = {};
}

/**
 * Registers an event listener.
 * @param {string} evt Event name
 * @param {function} fn Listener
 * @param {*} [ctx] Listener context
 * @returns {util.EventEmitter} `this`
 */
EventEmitter.prototype.on = function on(evt, fn, ctx) {
    (this._listeners[evt] || (this._listeners[evt] = [])).push({
        fn  : fn,
        ctx : ctx || this
    });
    return this;
};

/**
 * Removes an event listener or any matching listeners if arguments are omitted.
 * @param {string} [evt] Event name. Removes all listeners if omitted.
 * @param {function} [fn] Listener to remove. Removes all listeners of `evt` if omitted.
 * @returns {util.EventEmitter} `this`
 */
EventEmitter.prototype.off = function off(evt, fn) {
    if (evt === undefined)
        this._listeners = {};
    else {
        if (fn === undefined)
            this._listeners[evt] = [];
        else {
            var listeners = this._listeners[evt];
            for (var i = 0; i < listeners.length;)
                if (listeners[i].fn === fn)
                    listeners.splice(i, 1);
                else
                    ++i;
        }
    }
    return this;
};

/**
 * Emits an event by calling its listeners with the specified arguments.
 * @param {string} evt Event name
 * @param {...*} args Arguments
 * @returns {util.EventEmitter} `this`
 */
EventEmitter.prototype.emit = function emit(evt) {
    var listeners = this._listeners[evt];
    if (listeners) {
        var args = [],
            i = 1;
        for (; i < arguments.length;)
            args.push(arguments[i++]);
        for (i = 0; i < listeners.length;)
            listeners[i].fn.apply(listeners[i++].ctx, args);
    }
    return this;
};

},{}],7:[function(require,module,exports){
"use strict";
module.exports = fetch;

var asPromise = require("@protobufjs/aspromise"),
    inquire   = require("@protobufjs/inquire");

var fs = inquire("fs");

/**
 * Node-style callback as used by {@link util.fetch}.
 * @typedef FetchCallback
 * @type {function}
 * @param {?Error} error Error, if any, otherwise `null`
 * @param {string} [contents] File contents, if there hasn't been an error
 * @returns {undefined}
 */

/**
 * Options as used by {@link util.fetch}.
 * @typedef FetchOptions
 * @type {Object}
 * @property {boolean} [binary=false] Whether expecting a binary response
 * @property {boolean} [xhr=false] If `true`, forces the use of XMLHttpRequest
 */

/**
 * Fetches the contents of a file.
 * @memberof util
 * @param {string} filename File path or url
 * @param {FetchOptions} options Fetch options
 * @param {FetchCallback} callback Callback function
 * @returns {undefined}
 */
function fetch(filename, options, callback) {
    if (typeof options === "function") {
        callback = options;
        options = {};
    } else if (!options)
        options = {};

    if (!callback)
        return asPromise(fetch, this, filename, options); // eslint-disable-line no-invalid-this

    // if a node-like filesystem is present, try it first but fall back to XHR if nothing is found.
    if (!options.xhr && fs && fs.readFile)
        return fs.readFile(filename, function fetchReadFileCallback(err, contents) {
            return err && typeof XMLHttpRequest !== "undefined"
                ? fetch.xhr(filename, options, callback)
                : err
                ? callback(err)
                : callback(null, options.binary ? contents : contents.toString("utf8"));
        });

    // use the XHR version otherwise.
    return fetch.xhr(filename, options, callback);
}

/**
 * Fetches the contents of a file.
 * @name util.fetch
 * @function
 * @param {string} path File path or url
 * @param {FetchCallback} callback Callback function
 * @returns {undefined}
 * @variation 2
 */

/**
 * Fetches the contents of a file.
 * @name util.fetch
 * @function
 * @param {string} path File path or url
 * @param {FetchOptions} [options] Fetch options
 * @returns {Promise<string|Uint8Array>} Promise
 * @variation 3
 */

/**/
fetch.xhr = function fetch_xhr(filename, options, callback) {
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange /* works everywhere */ = function fetchOnReadyStateChange() {

        if (xhr.readyState !== 4)
            return undefined;

        // local cors security errors return status 0 / empty string, too. afaik this cannot be
        // reliably distinguished from an actually empty file for security reasons. feel free
        // to send a pull request if you are aware of a solution.
        if (xhr.status !== 0 && xhr.status !== 200)
            return callback(Error("status " + xhr.status));

        // if binary data is expected, make sure that some sort of array is returned, even if
        // ArrayBuffers are not supported. the binary string fallback, however, is unsafe.
        if (options.binary) {
            var buffer = xhr.response;
            if (!buffer) {
                buffer = [];
                for (var i = 0; i < xhr.responseText.length; ++i)
                    buffer.push(xhr.responseText.charCodeAt(i) & 255);
            }
            return callback(null, typeof Uint8Array !== "undefined" ? new Uint8Array(buffer) : buffer);
        }
        return callback(null, xhr.responseText);
    };

    if (options.binary) {
        // ref: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Sending_and_Receiving_Binary_Data#Receiving_binary_data_in_older_browsers
        if ("overrideMimeType" in xhr)
            xhr.overrideMimeType("text/plain; charset=x-user-defined");
        xhr.responseType = "arraybuffer";
    }

    xhr.open("GET", filename);
    xhr.send();
};

},{"@protobufjs/aspromise":3,"@protobufjs/inquire":9}],8:[function(require,module,exports){
"use strict";

module.exports = factory(factory);

/**
 * Reads / writes floats / doubles from / to buffers.
 * @name util.float
 * @namespace
 */

/**
 * Writes a 32 bit float to a buffer using little endian byte order.
 * @name util.float.writeFloatLE
 * @function
 * @param {number} val Value to write
 * @param {Uint8Array} buf Target buffer
 * @param {number} pos Target buffer offset
 * @returns {undefined}
 */

/**
 * Writes a 32 bit float to a buffer using big endian byte order.
 * @name util.float.writeFloatBE
 * @function
 * @param {number} val Value to write
 * @param {Uint8Array} buf Target buffer
 * @param {number} pos Target buffer offset
 * @returns {undefined}
 */

/**
 * Reads a 32 bit float from a buffer using little endian byte order.
 * @name util.float.readFloatLE
 * @function
 * @param {Uint8Array} buf Source buffer
 * @param {number} pos Source buffer offset
 * @returns {number} Value read
 */

/**
 * Reads a 32 bit float from a buffer using big endian byte order.
 * @name util.float.readFloatBE
 * @function
 * @param {Uint8Array} buf Source buffer
 * @param {number} pos Source buffer offset
 * @returns {number} Value read
 */

/**
 * Writes a 64 bit double to a buffer using little endian byte order.
 * @name util.float.writeDoubleLE
 * @function
 * @param {number} val Value to write
 * @param {Uint8Array} buf Target buffer
 * @param {number} pos Target buffer offset
 * @returns {undefined}
 */

/**
 * Writes a 64 bit double to a buffer using big endian byte order.
 * @name util.float.writeDoubleBE
 * @function
 * @param {number} val Value to write
 * @param {Uint8Array} buf Target buffer
 * @param {number} pos Target buffer offset
 * @returns {undefined}
 */

/**
 * Reads a 64 bit double from a buffer using little endian byte order.
 * @name util.float.readDoubleLE
 * @function
 * @param {Uint8Array} buf Source buffer
 * @param {number} pos Source buffer offset
 * @returns {number} Value read
 */

/**
 * Reads a 64 bit double from a buffer using big endian byte order.
 * @name util.float.readDoubleBE
 * @function
 * @param {Uint8Array} buf Source buffer
 * @param {number} pos Source buffer offset
 * @returns {number} Value read
 */

// Factory function for the purpose of node-based testing in modified global environments
function factory(exports) {

    // float: typed array
    if (typeof Float32Array !== "undefined") (function() {

        var f32 = new Float32Array([ -0 ]),
            f8b = new Uint8Array(f32.buffer),
            le  = f8b[3] === 128;

        function writeFloat_f32_cpy(val, buf, pos) {
            f32[0] = val;
            buf[pos    ] = f8b[0];
            buf[pos + 1] = f8b[1];
            buf[pos + 2] = f8b[2];
            buf[pos + 3] = f8b[3];
        }

        function writeFloat_f32_rev(val, buf, pos) {
            f32[0] = val;
            buf[pos    ] = f8b[3];
            buf[pos + 1] = f8b[2];
            buf[pos + 2] = f8b[1];
            buf[pos + 3] = f8b[0];
        }

        /* istanbul ignore next */
        exports.writeFloatLE = le ? writeFloat_f32_cpy : writeFloat_f32_rev;
        /* istanbul ignore next */
        exports.writeFloatBE = le ? writeFloat_f32_rev : writeFloat_f32_cpy;

        function readFloat_f32_cpy(buf, pos) {
            f8b[0] = buf[pos    ];
            f8b[1] = buf[pos + 1];
            f8b[2] = buf[pos + 2];
            f8b[3] = buf[pos + 3];
            return f32[0];
        }

        function readFloat_f32_rev(buf, pos) {
            f8b[3] = buf[pos    ];
            f8b[2] = buf[pos + 1];
            f8b[1] = buf[pos + 2];
            f8b[0] = buf[pos + 3];
            return f32[0];
        }

        /* istanbul ignore next */
        exports.readFloatLE = le ? readFloat_f32_cpy : readFloat_f32_rev;
        /* istanbul ignore next */
        exports.readFloatBE = le ? readFloat_f32_rev : readFloat_f32_cpy;

    // float: ieee754
    })(); else (function() {

        function writeFloat_ieee754(writeUint, val, buf, pos) {
            var sign = val < 0 ? 1 : 0;
            if (sign)
                val = -val;
            if (val === 0)
                writeUint(1 / val > 0 ? /* positive */ 0 : /* negative 0 */ 2147483648, buf, pos);
            else if (isNaN(val))
                writeUint(2143289344, buf, pos);
            else if (val > 3.4028234663852886e+38) // +-Infinity
                writeUint((sign << 31 | 2139095040) >>> 0, buf, pos);
            else if (val < 1.1754943508222875e-38) // denormal
                writeUint((sign << 31 | Math.round(val / 1.401298464324817e-45)) >>> 0, buf, pos);
            else {
                var exponent = Math.floor(Math.log(val) / Math.LN2),
                    mantissa = Math.round(val * Math.pow(2, -exponent) * 8388608) & 8388607;
                writeUint((sign << 31 | exponent + 127 << 23 | mantissa) >>> 0, buf, pos);
            }
        }

        exports.writeFloatLE = writeFloat_ieee754.bind(null, writeUintLE);
        exports.writeFloatBE = writeFloat_ieee754.bind(null, writeUintBE);

        function readFloat_ieee754(readUint, buf, pos) {
            var uint = readUint(buf, pos),
                sign = (uint >> 31) * 2 + 1,
                exponent = uint >>> 23 & 255,
                mantissa = uint & 8388607;
            return exponent === 255
                ? mantissa
                ? NaN
                : sign * Infinity
                : exponent === 0 // denormal
                ? sign * 1.401298464324817e-45 * mantissa
                : sign * Math.pow(2, exponent - 150) * (mantissa + 8388608);
        }

        exports.readFloatLE = readFloat_ieee754.bind(null, readUintLE);
        exports.readFloatBE = readFloat_ieee754.bind(null, readUintBE);

    })();

    // double: typed array
    if (typeof Float64Array !== "undefined") (function() {

        var f64 = new Float64Array([-0]),
            f8b = new Uint8Array(f64.buffer),
            le  = f8b[7] === 128;

        function writeDouble_f64_cpy(val, buf, pos) {
            f64[0] = val;
            buf[pos    ] = f8b[0];
            buf[pos + 1] = f8b[1];
            buf[pos + 2] = f8b[2];
            buf[pos + 3] = f8b[3];
            buf[pos + 4] = f8b[4];
            buf[pos + 5] = f8b[5];
            buf[pos + 6] = f8b[6];
            buf[pos + 7] = f8b[7];
        }

        function writeDouble_f64_rev(val, buf, pos) {
            f64[0] = val;
            buf[pos    ] = f8b[7];
            buf[pos + 1] = f8b[6];
            buf[pos + 2] = f8b[5];
            buf[pos + 3] = f8b[4];
            buf[pos + 4] = f8b[3];
            buf[pos + 5] = f8b[2];
            buf[pos + 6] = f8b[1];
            buf[pos + 7] = f8b[0];
        }

        /* istanbul ignore next */
        exports.writeDoubleLE = le ? writeDouble_f64_cpy : writeDouble_f64_rev;
        /* istanbul ignore next */
        exports.writeDoubleBE = le ? writeDouble_f64_rev : writeDouble_f64_cpy;

        function readDouble_f64_cpy(buf, pos) {
            f8b[0] = buf[pos    ];
            f8b[1] = buf[pos + 1];
            f8b[2] = buf[pos + 2];
            f8b[3] = buf[pos + 3];
            f8b[4] = buf[pos + 4];
            f8b[5] = buf[pos + 5];
            f8b[6] = buf[pos + 6];
            f8b[7] = buf[pos + 7];
            return f64[0];
        }

        function readDouble_f64_rev(buf, pos) {
            f8b[7] = buf[pos    ];
            f8b[6] = buf[pos + 1];
            f8b[5] = buf[pos + 2];
            f8b[4] = buf[pos + 3];
            f8b[3] = buf[pos + 4];
            f8b[2] = buf[pos + 5];
            f8b[1] = buf[pos + 6];
            f8b[0] = buf[pos + 7];
            return f64[0];
        }

        /* istanbul ignore next */
        exports.readDoubleLE = le ? readDouble_f64_cpy : readDouble_f64_rev;
        /* istanbul ignore next */
        exports.readDoubleBE = le ? readDouble_f64_rev : readDouble_f64_cpy;

    // double: ieee754
    })(); else (function() {

        function writeDouble_ieee754(writeUint, off0, off1, val, buf, pos) {
            var sign = val < 0 ? 1 : 0;
            if (sign)
                val = -val;
            if (val === 0) {
                writeUint(0, buf, pos + off0);
                writeUint(1 / val > 0 ? /* positive */ 0 : /* negative 0 */ 2147483648, buf, pos + off1);
            } else if (isNaN(val)) {
                writeUint(0, buf, pos + off0);
                writeUint(2146959360, buf, pos + off1);
            } else if (val > 1.7976931348623157e+308) { // +-Infinity
                writeUint(0, buf, pos + off0);
                writeUint((sign << 31 | 2146435072) >>> 0, buf, pos + off1);
            } else {
                var mantissa;
                if (val < 2.2250738585072014e-308) { // denormal
                    mantissa = val / 5e-324;
                    writeUint(mantissa >>> 0, buf, pos + off0);
                    writeUint((sign << 31 | mantissa / 4294967296) >>> 0, buf, pos + off1);
                } else {
                    var exponent = Math.floor(Math.log(val) / Math.LN2);
                    if (exponent === 1024)
                        exponent = 1023;
                    mantissa = val * Math.pow(2, -exponent);
                    writeUint(mantissa * 4503599627370496 >>> 0, buf, pos + off0);
                    writeUint((sign << 31 | exponent + 1023 << 20 | mantissa * 1048576 & 1048575) >>> 0, buf, pos + off1);
                }
            }
        }

        exports.writeDoubleLE = writeDouble_ieee754.bind(null, writeUintLE, 0, 4);
        exports.writeDoubleBE = writeDouble_ieee754.bind(null, writeUintBE, 4, 0);

        function readDouble_ieee754(readUint, off0, off1, buf, pos) {
            var lo = readUint(buf, pos + off0),
                hi = readUint(buf, pos + off1);
            var sign = (hi >> 31) * 2 + 1,
                exponent = hi >>> 20 & 2047,
                mantissa = 4294967296 * (hi & 1048575) + lo;
            return exponent === 2047
                ? mantissa
                ? NaN
                : sign * Infinity
                : exponent === 0 // denormal
                ? sign * 5e-324 * mantissa
                : sign * Math.pow(2, exponent - 1075) * (mantissa + 4503599627370496);
        }

        exports.readDoubleLE = readDouble_ieee754.bind(null, readUintLE, 0, 4);
        exports.readDoubleBE = readDouble_ieee754.bind(null, readUintBE, 4, 0);

    })();

    return exports;
}

// uint helpers

function writeUintLE(val, buf, pos) {
    buf[pos    ] =  val        & 255;
    buf[pos + 1] =  val >>> 8  & 255;
    buf[pos + 2] =  val >>> 16 & 255;
    buf[pos + 3] =  val >>> 24;
}

function writeUintBE(val, buf, pos) {
    buf[pos    ] =  val >>> 24;
    buf[pos + 1] =  val >>> 16 & 255;
    buf[pos + 2] =  val >>> 8  & 255;
    buf[pos + 3] =  val        & 255;
}

function readUintLE(buf, pos) {
    return (buf[pos    ]
          | buf[pos + 1] << 8
          | buf[pos + 2] << 16
          | buf[pos + 3] << 24) >>> 0;
}

function readUintBE(buf, pos) {
    return (buf[pos    ] << 24
          | buf[pos + 1] << 16
          | buf[pos + 2] << 8
          | buf[pos + 3]) >>> 0;
}

},{}],9:[function(require,module,exports){
"use strict";
module.exports = inquire;

/**
 * Requires a module only if available.
 * @memberof util
 * @param {string} moduleName Module to require
 * @returns {?Object} Required module if available and not empty, otherwise `null`
 */
function inquire(moduleName) {
    try {
        var mod = eval("quire".replace(/^/,"re"))(moduleName); // eslint-disable-line no-eval
        if (mod && (mod.length || Object.keys(mod).length))
            return mod;
    } catch (e) {} // eslint-disable-line no-empty
    return null;
}

},{}],10:[function(require,module,exports){
"use strict";

/**
 * A minimal path module to resolve Unix, Windows and URL paths alike.
 * @memberof util
 * @namespace
 */
var path = exports;

var isAbsolute =
/**
 * Tests if the specified path is absolute.
 * @param {string} path Path to test
 * @returns {boolean} `true` if path is absolute
 */
path.isAbsolute = function isAbsolute(path) {
    return /^(?:\/|\w+:)/.test(path);
};

var normalize =
/**
 * Normalizes the specified path.
 * @param {string} path Path to normalize
 * @returns {string} Normalized path
 */
path.normalize = function normalize(path) {
    path = path.replace(/\\/g, "/")
               .replace(/\/{2,}/g, "/");
    var parts    = path.split("/"),
        absolute = isAbsolute(path),
        prefix   = "";
    if (absolute)
        prefix = parts.shift() + "/";
    for (var i = 0; i < parts.length;) {
        if (parts[i] === "..") {
            if (i > 0 && parts[i - 1] !== "..")
                parts.splice(--i, 2);
            else if (absolute)
                parts.splice(i, 1);
            else
                ++i;
        } else if (parts[i] === ".")
            parts.splice(i, 1);
        else
            ++i;
    }
    return prefix + parts.join("/");
};

/**
 * Resolves the specified include path against the specified origin path.
 * @param {string} originPath Path to the origin file
 * @param {string} includePath Include path relative to origin path
 * @param {boolean} [alreadyNormalized=false] `true` if both paths are already known to be normalized
 * @returns {string} Path to the include file
 */
path.resolve = function resolve(originPath, includePath, alreadyNormalized) {
    if (!alreadyNormalized)
        includePath = normalize(includePath);
    if (isAbsolute(includePath))
        return includePath;
    if (!alreadyNormalized)
        originPath = normalize(originPath);
    return (originPath = originPath.replace(/(?:\/|^)[^/]+$/, "")).length ? normalize(originPath + "/" + includePath) : includePath;
};

},{}],11:[function(require,module,exports){
"use strict";
module.exports = pool;

/**
 * An allocator as used by {@link util.pool}.
 * @typedef PoolAllocator
 * @type {function}
 * @param {number} size Buffer size
 * @returns {Uint8Array} Buffer
 */

/**
 * A slicer as used by {@link util.pool}.
 * @typedef PoolSlicer
 * @type {function}
 * @param {number} start Start offset
 * @param {number} end End offset
 * @returns {Uint8Array} Buffer slice
 * @this {Uint8Array}
 */

/**
 * A general purpose buffer pool.
 * @memberof util
 * @function
 * @param {PoolAllocator} alloc Allocator
 * @param {PoolSlicer} slice Slicer
 * @param {number} [size=8192] Slab size
 * @returns {PoolAllocator} Pooled allocator
 */
function pool(alloc, slice, size) {
    var SIZE   = size || 8192;
    var MAX    = SIZE >>> 1;
    var slab   = null;
    var offset = SIZE;
    return function pool_alloc(size) {
        if (size < 1 || size > MAX)
            return alloc(size);
        if (offset + size > SIZE) {
            slab = alloc(SIZE);
            offset = 0;
        }
        var buf = slice.call(slab, offset, offset += size);
        if (offset & 7) // align to 32 bit
            offset = (offset | 7) + 1;
        return buf;
    };
}

},{}],12:[function(require,module,exports){
"use strict";

/**
 * A minimal UTF8 implementation for number arrays.
 * @memberof util
 * @namespace
 */
var utf8 = exports;

/**
 * Calculates the UTF8 byte length of a string.
 * @param {string} string String
 * @returns {number} Byte length
 */
utf8.length = function utf8_length(string) {
    var len = 0,
        c = 0;
    for (var i = 0; i < string.length; ++i) {
        c = string.charCodeAt(i);
        if (c < 128)
            len += 1;
        else if (c < 2048)
            len += 2;
        else if ((c & 0xFC00) === 0xD800 && (string.charCodeAt(i + 1) & 0xFC00) === 0xDC00) {
            ++i;
            len += 4;
        } else
            len += 3;
    }
    return len;
};

/**
 * Reads UTF8 bytes as a string.
 * @param {Uint8Array} buffer Source buffer
 * @param {number} start Source start
 * @param {number} end Source end
 * @returns {string} String read
 */
utf8.read = function utf8_read(buffer, start, end) {
    var len = end - start;
    if (len < 1)
        return "";
    var parts = null,
        chunk = [],
        i = 0, // char offset
        t;     // temporary
    while (start < end) {
        t = buffer[start++];
        if (t < 128)
            chunk[i++] = t;
        else if (t > 191 && t < 224)
            chunk[i++] = (t & 31) << 6 | buffer[start++] & 63;
        else if (t > 239 && t < 365) {
            t = ((t & 7) << 18 | (buffer[start++] & 63) << 12 | (buffer[start++] & 63) << 6 | buffer[start++] & 63) - 0x10000;
            chunk[i++] = 0xD800 + (t >> 10);
            chunk[i++] = 0xDC00 + (t & 1023);
        } else
            chunk[i++] = (t & 15) << 12 | (buffer[start++] & 63) << 6 | buffer[start++] & 63;
        if (i > 8191) {
            (parts || (parts = [])).push(String.fromCharCode.apply(String, chunk));
            i = 0;
        }
    }
    if (parts) {
        if (i)
            parts.push(String.fromCharCode.apply(String, chunk.slice(0, i)));
        return parts.join("");
    }
    return String.fromCharCode.apply(String, chunk.slice(0, i));
};

/**
 * Writes a string as UTF8 bytes.
 * @param {string} string Source string
 * @param {Uint8Array} buffer Destination buffer
 * @param {number} offset Destination offset
 * @returns {number} Bytes written
 */
utf8.write = function utf8_write(string, buffer, offset) {
    var start = offset,
        c1, // character 1
        c2; // character 2
    for (var i = 0; i < string.length; ++i) {
        c1 = string.charCodeAt(i);
        if (c1 < 128) {
            buffer[offset++] = c1;
        } else if (c1 < 2048) {
            buffer[offset++] = c1 >> 6       | 192;
            buffer[offset++] = c1       & 63 | 128;
        } else if ((c1 & 0xFC00) === 0xD800 && ((c2 = string.charCodeAt(i + 1)) & 0xFC00) === 0xDC00) {
            c1 = 0x10000 + ((c1 & 0x03FF) << 10) + (c2 & 0x03FF);
            ++i;
            buffer[offset++] = c1 >> 18      | 240;
            buffer[offset++] = c1 >> 12 & 63 | 128;
            buffer[offset++] = c1 >> 6  & 63 | 128;
            buffer[offset++] = c1       & 63 | 128;
        } else {
            buffer[offset++] = c1 >> 12      | 224;
            buffer[offset++] = c1 >> 6  & 63 | 128;
            buffer[offset++] = c1       & 63 | 128;
        }
    }
    return offset - start;
};

},{}],13:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var R = typeof Reflect === 'object' ? Reflect : null
var ReflectApply = R && typeof R.apply === 'function'
  ? R.apply
  : function ReflectApply(target, receiver, args) {
    return Function.prototype.apply.call(target, receiver, args);
  }

var ReflectOwnKeys
if (R && typeof R.ownKeys === 'function') {
  ReflectOwnKeys = R.ownKeys
} else if (Object.getOwnPropertySymbols) {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target)
      .concat(Object.getOwnPropertySymbols(target));
  };
} else {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target);
  };
}

function ProcessEmitWarning(warning) {
  if (console && console.warn) console.warn(warning);
}

var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
  return value !== value;
}

function EventEmitter() {
  EventEmitter.init.call(this);
}
module.exports = EventEmitter;
module.exports.once = once;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

function checkListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}

Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  enumerable: true,
  get: function() {
    return defaultMaxListeners;
  },
  set: function(arg) {
    if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
      throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
    }
    defaultMaxListeners = arg;
  }
});

EventEmitter.init = function() {

  if (this._events === undefined ||
      this._events === Object.getPrototypeOf(this)._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
};

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
  }
  this._maxListeners = n;
  return this;
};

function _getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return _getMaxListeners(this);
};

EventEmitter.prototype.emit = function emit(type) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  var doError = (type === 'error');

  var events = this._events;
  if (events !== undefined)
    doError = (doError && events.error === undefined);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    var er;
    if (args.length > 0)
      er = args[0];
    if (er instanceof Error) {
      // Note: The comments on the `throw` lines are intentional, they show
      // up in Node's output if this results in an unhandled exception.
      throw er; // Unhandled 'error' event
    }
    // At least give some kind of context to the user
    var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
    err.context = er;
    throw err; // Unhandled 'error' event
  }

  var handler = events[type];

  if (handler === undefined)
    return false;

  if (typeof handler === 'function') {
    ReflectApply(handler, this, args);
  } else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      ReflectApply(listeners[i], this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  checkListener(listener);

  events = target._events;
  if (events === undefined) {
    events = target._events = Object.create(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener !== undefined) {
      target.emit('newListener', type,
                  listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (existing === undefined) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
        prepend ? [listener, existing] : [existing, listener];
      // If we've already got an array, just append.
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // Check for listener leak
    m = _getMaxListeners(target);
    if (m > 0 && existing.length > m && !existing.warned) {
      existing.warned = true;
      // No error code for this since it is a Warning
      // eslint-disable-next-line no-restricted-syntax
      var w = new Error('Possible EventEmitter memory leak detected. ' +
                          existing.length + ' ' + String(type) + ' listeners ' +
                          'added. Use emitter.setMaxListeners() to ' +
                          'increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.emitter = target;
      w.type = type;
      w.count = existing.length;
      ProcessEmitWarning(w);
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    if (arguments.length === 0)
      return this.listener.call(this.target);
    return this.listener.apply(this.target, arguments);
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  checkListener(listener);
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      checkListener(listener);

      events = this._events;
      if (events === undefined)
        return this;

      list = events[type];
      if (list === undefined)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener !== undefined)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (events === undefined)
        return this;

      // not listening for removeListener, no need to emit
      if (events.removeListener === undefined) {
        if (arguments.length === 0) {
          this._events = Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== undefined) {
          if (--this._eventsCount === 0)
            this._events = Object.create(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = Object.create(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners !== undefined) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (events === undefined)
    return [];

  var evlistener = events[type];
  if (evlistener === undefined)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ?
    unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events !== undefined) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
};

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function spliceOne(list, index) {
  for (; index + 1 < list.length; index++)
    list[index] = list[index + 1];
  list.pop();
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function once(emitter, name) {
  return new Promise(function (resolve, reject) {
    function errorListener(err) {
      emitter.removeListener(name, resolver);
      reject(err);
    }

    function resolver() {
      if (typeof emitter.removeListener === 'function') {
        emitter.removeListener('error', errorListener);
      }
      resolve([].slice.call(arguments));
    };

    eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
    if (name !== 'error') {
      addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
    }
  });
}

function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
  if (typeof emitter.on === 'function') {
    eventTargetAgnosticAddListener(emitter, 'error', handler, flags);
  }
}

function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === 'function') {
    if (flags.once) {
      emitter.once(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === 'function') {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we do not listen for `error` events here.
    emitter.addEventListener(name, function wrapListener(arg) {
      // IE does not have builtin `{ once: true }` support so we
      // have to do it manually.
      if (flags.once) {
        emitter.removeEventListener(name, wrapListener);
      }
      listener(arg);
    });
  } else {
    throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
  }
}

},{}],14:[function(require,module,exports){
(function (setImmediate){(function (){
/*! For license information please see jimp.js.LICENSE.txt */
(()=>{var __webpack_modules__={236:(t,e,r)=>{var i=r(4618);function n(t,e){var r=new i(t,e);return function(t){return r.convert(t)}}n.BIN="01",n.OCT="01234567",n.DEC="0123456789",n.HEX="0123456789abcdef",t.exports=n},4618:t=>{"use strict";function e(t,e){if(!(t&&e&&t.length&&e.length))throw new Error("Bad alphabet");this.srcAlphabet=t,this.dstAlphabet=e}e.prototype.convert=function(t){var e,r,i,n={},a=this.srcAlphabet.length,o=this.dstAlphabet.length,s=t.length,h="string"==typeof t?"":[];if(!this.isValid(t))throw new Error('Number "'+t+'" contains of non-alphabetic digits ('+this.srcAlphabet+")");if(this.srcAlphabet===this.dstAlphabet)return t;for(e=0;e<s;e++)n[e]=this.srcAlphabet.indexOf(t[e]);do{for(r=0,i=0,e=0;e<s;e++)(r=r*a+n[e])>=o?(n[i++]=parseInt(r/o,10),r%=o):i>0&&(n[i++]=0);s=i,h=this.dstAlphabet.slice(r,r+1).concat(h)}while(0!==i);return h},e.prototype.isValid=function(t){for(var e=0;e<t.length;++e)if(-1===this.srcAlphabet.indexOf(t[e]))return!1;return!0},t.exports=e},5766:(t,e)=>{"use strict";e.byteLength=function(t){var e=h(t),r=e[0],i=e[1];return 3*(r+i)/4-i},e.toByteArray=function(t){var e,r,a=h(t),o=a[0],s=a[1],l=new n(function(t,e,r){return 3*(e+r)/4-r}(0,o,s)),f=0,u=s>0?o-4:o;for(r=0;r<u;r+=4)e=i[t.charCodeAt(r)]<<18|i[t.charCodeAt(r+1)]<<12|i[t.charCodeAt(r+2)]<<6|i[t.charCodeAt(r+3)],l[f++]=e>>16&255,l[f++]=e>>8&255,l[f++]=255&e;return 2===s&&(e=i[t.charCodeAt(r)]<<2|i[t.charCodeAt(r+1)]>>4,l[f++]=255&e),1===s&&(e=i[t.charCodeAt(r)]<<10|i[t.charCodeAt(r+1)]<<4|i[t.charCodeAt(r+2)]>>2,l[f++]=e>>8&255,l[f++]=255&e),l},e.fromByteArray=function(t){for(var e,i=t.length,n=i%3,a=[],o=16383,s=0,h=i-n;s<h;s+=o)a.push(l(t,s,s+o>h?h:s+o));return 1===n?(e=t[i-1],a.push(r[e>>2]+r[e<<4&63]+"==")):2===n&&(e=(t[i-2]<<8)+t[i-1],a.push(r[e>>10]+r[e>>4&63]+r[e<<2&63]+"=")),a.join("")};for(var r=[],i=[],n="undefined"!=typeof Uint8Array?Uint8Array:Array,a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",o=0,s=a.length;o<s;++o)r[o]=a[o],i[a.charCodeAt(o)]=o;function h(t){var e=t.length;if(e%4>0)throw new Error("Invalid string. Length must be a multiple of 4");var r=t.indexOf("=");return-1===r&&(r=e),[r,r===e?0:4-r%4]}function l(t,e,i){for(var n,a,o=[],s=e;s<i;s+=3)n=(t[s]<<16&16711680)+(t[s+1]<<8&65280)+(255&t[s+2]),o.push(r[(a=n)>>18&63]+r[a>>12&63]+r[a>>6&63]+r[63&a]);return o.join("")}i["-".charCodeAt(0)]=62,i["_".charCodeAt(0)]=63},486:(t,e,r)=>{var i=r(5433),n=r(1651);t.exports={encode:i,decode:n}},1651:(t,e,r)=>{var i=r(8834).lW;function n(t,e){if(this.pos=0,this.buffer=t,this.is_with_alpha=!!e,this.bottom_up=!0,this.flag=this.buffer.toString("utf-8",0,this.pos+=2),"BM"!=this.flag)throw new Error("Invalid BMP File");this.parseHeader(),this.parseRGBA()}n.prototype.parseHeader=function(){if(this.fileSize=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.reserved=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.offset=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.headerSize=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.width=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.height=this.buffer.readInt32LE(this.pos),this.pos+=4,this.planes=this.buffer.readUInt16LE(this.pos),this.pos+=2,this.bitPP=this.buffer.readUInt16LE(this.pos),this.pos+=2,this.compress=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.rawSize=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.hr=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.vr=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.colors=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.importantColors=this.buffer.readUInt32LE(this.pos),this.pos+=4,16===this.bitPP&&this.is_with_alpha&&(this.bitPP=15),this.bitPP<15){var t=0===this.colors?1<<this.bitPP:this.colors;this.palette=new Array(t);for(var e=0;e<t;e++){var r=this.buffer.readUInt8(this.pos++),i=this.buffer.readUInt8(this.pos++),n=this.buffer.readUInt8(this.pos++),a=this.buffer.readUInt8(this.pos++);this.palette[e]={red:n,green:i,blue:r,quad:a}}}this.height<0&&(this.height*=-1,this.bottom_up=!1)},n.prototype.parseRGBA=function(){var t="bit"+this.bitPP,e=this.width*this.height*4;this.data=new i(e),this[t]()},n.prototype.bit1=function(){var t=Math.ceil(this.width/8),e=t%4,r=this.height>=0?this.height-1:-this.height;for(r=this.height-1;r>=0;r--){for(var i=this.bottom_up?r:this.height-1-r,n=0;n<t;n++)for(var a=this.buffer.readUInt8(this.pos++),o=i*this.width*4+8*n*4,s=0;s<8&&8*n+s<this.width;s++){var h=this.palette[a>>7-s&1];this.data[o+4*s]=0,this.data[o+4*s+1]=h.blue,this.data[o+4*s+2]=h.green,this.data[o+4*s+3]=h.red}0!=e&&(this.pos+=4-e)}},n.prototype.bit4=function(){if(2==this.compress){this.data.fill(255);for(var t=0,e=this.bottom_up?this.height-1:0,r=!1;t<this.data.length;){var i=this.buffer.readUInt8(this.pos++),n=this.buffer.readUInt8(this.pos++);if(0==i){if(0==n){this.bottom_up?e--:e++,t=e*this.width*4,r=!1;continue}if(1==n)break;if(2==n){var a=this.buffer.readUInt8(this.pos++),o=this.buffer.readUInt8(this.pos++);this.bottom_up?e-=o:e+=o,t+=o*this.width*4+4*a}else{for(var s=this.buffer.readUInt8(this.pos++),h=0;h<n;h++)r?l.call(this,15&s):l.call(this,(240&s)>>4),1&h&&h+1<n&&(s=this.buffer.readUInt8(this.pos++)),r=!r;1==(n+1>>1&1)&&this.pos++}}else for(h=0;h<i;h++)r?l.call(this,15&n):l.call(this,(240&n)>>4),r=!r}function l(e){var r=this.palette[e];this.data[t]=0,this.data[t+1]=r.blue,this.data[t+2]=r.green,this.data[t+3]=r.red,t+=4}}else{var f=Math.ceil(this.width/2),u=f%4;for(o=this.height-1;o>=0;o--){var c=this.bottom_up?o:this.height-1-o;for(a=0;a<f;a++){n=this.buffer.readUInt8(this.pos++),t=c*this.width*4+2*a*4;var d=n>>4,p=15&n,m=this.palette[d];if(this.data[t]=0,this.data[t+1]=m.blue,this.data[t+2]=m.green,this.data[t+3]=m.red,2*a+1>=this.width)break;m=this.palette[p],this.data[t+4]=0,this.data[t+4+1]=m.blue,this.data[t+4+2]=m.green,this.data[t+4+3]=m.red}0!=u&&(this.pos+=4-u)}}},n.prototype.bit8=function(){if(1==this.compress){this.data.fill(255);for(var t=0,e=this.bottom_up?this.height-1:0;t<this.data.length;){var r=this.buffer.readUInt8(this.pos++),i=this.buffer.readUInt8(this.pos++);if(0==r){if(0==i){this.bottom_up?e--:e++,t=e*this.width*4;continue}if(1==i)break;if(2==i){var n=this.buffer.readUInt8(this.pos++),a=this.buffer.readUInt8(this.pos++);this.bottom_up?e-=a:e+=a,t+=a*this.width*4+4*n}else{for(var o=0;o<i;o++){var s=this.buffer.readUInt8(this.pos++);h.call(this,s)}!0&i&&this.pos++}}else for(o=0;o<r;o++)h.call(this,i)}function h(e){var r=this.palette[e];this.data[t]=0,this.data[t+1]=r.blue,this.data[t+2]=r.green,this.data[t+3]=r.red,t+=4}}else{var l=this.width%4;for(a=this.height-1;a>=0;a--){var f=this.bottom_up?a:this.height-1-a;for(n=0;n<this.width;n++)if(i=this.buffer.readUInt8(this.pos++),t=f*this.width*4+4*n,i<this.palette.length){var u=this.palette[i];this.data[t]=0,this.data[t+1]=u.blue,this.data[t+2]=u.green,this.data[t+3]=u.red}else this.data[t]=0,this.data[t+1]=255,this.data[t+2]=255,this.data[t+3]=255;0!=l&&(this.pos+=4-l)}}},n.prototype.bit15=function(){for(var t=this.width%3,e=parseInt("11111",2),r=this.height-1;r>=0;r--){for(var i=this.bottom_up?r:this.height-1-r,n=0;n<this.width;n++){var a=this.buffer.readUInt16LE(this.pos);this.pos+=2;var o=(a&e)/e*255|0,s=(a>>5&e)/e*255|0,h=(a>>10&e)/e*255|0,l=a>>15?255:0,f=i*this.width*4+4*n;this.data[f]=l,this.data[f+1]=o,this.data[f+2]=s,this.data[f+3]=h}this.pos+=t}},n.prototype.bit16=function(){var t=this.width%2*2;this.maskRed=31744,this.maskGreen=992,this.maskBlue=31,this.mask0=0,3==this.compress&&(this.maskRed=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.maskGreen=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.maskBlue=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.mask0=this.buffer.readUInt32LE(this.pos),this.pos+=4);for(var e=[0,0,0],r=0;r<16;r++)this.maskRed>>r&1&&e[0]++,this.maskGreen>>r&1&&e[1]++,this.maskBlue>>r&1&&e[2]++;e[1]+=e[0],e[2]+=e[1],e[0]=8-e[0],e[1]-=8,e[2]-=8;for(var i=this.height-1;i>=0;i--){for(var n=this.bottom_up?i:this.height-1-i,a=0;a<this.width;a++){var o=this.buffer.readUInt16LE(this.pos);this.pos+=2;var s=(o&this.maskBlue)<<e[0],h=(o&this.maskGreen)>>e[1],l=(o&this.maskRed)>>e[2],f=n*this.width*4+4*a;this.data[f]=0,this.data[f+1]=s,this.data[f+2]=h,this.data[f+3]=l}this.pos+=t}},n.prototype.bit24=function(){for(var t=this.height-1;t>=0;t--){for(var e=this.bottom_up?t:this.height-1-t,r=0;r<this.width;r++){var i=this.buffer.readUInt8(this.pos++),n=this.buffer.readUInt8(this.pos++),a=this.buffer.readUInt8(this.pos++),o=e*this.width*4+4*r;this.data[o]=0,this.data[o+1]=i,this.data[o+2]=n,this.data[o+3]=a}this.pos+=this.width%4}},n.prototype.bit32=function(){if(3==this.compress){this.maskRed=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.maskGreen=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.maskBlue=this.buffer.readUInt32LE(this.pos),this.pos+=4,this.mask0=this.buffer.readUInt32LE(this.pos),this.pos+=4;for(var t=this.height-1;t>=0;t--)for(var e=this.bottom_up?t:this.height-1-t,r=0;r<this.width;r++){var i=this.buffer.readUInt8(this.pos++),n=this.buffer.readUInt8(this.pos++),a=this.buffer.readUInt8(this.pos++),o=this.buffer.readUInt8(this.pos++),s=e*this.width*4+4*r;this.data[s]=i,this.data[s+1]=n,this.data[s+2]=a,this.data[s+3]=o}}else for(t=this.height-1;t>=0;t--)for(e=this.bottom_up?t:this.height-1-t,r=0;r<this.width;r++)n=this.buffer.readUInt8(this.pos++),a=this.buffer.readUInt8(this.pos++),o=this.buffer.readUInt8(this.pos++),i=this.buffer.readUInt8(this.pos++),s=e*this.width*4+4*r,this.data[s]=i,this.data[s+1]=n,this.data[s+2]=a,this.data[s+3]=o},n.prototype.getData=function(){return this.data},t.exports=function(t){return new n(t)}},5433:(t,e,r)=>{var i=r(8834).lW;function n(t){this.buffer=t.data,this.width=t.width,this.height=t.height,this.extraBytes=this.width%4,this.rgbSize=this.height*(3*this.width+this.extraBytes),this.headerInfoSize=40,this.data=[],this.flag="BM",this.reserved=0,this.offset=54,this.fileSize=this.rgbSize+this.offset,this.planes=1,this.bitPP=24,this.compress=0,this.hr=0,this.vr=0,this.colors=0,this.importantColors=0}n.prototype.encode=function(){var t=new i(this.offset+this.rgbSize);this.pos=0,t.write(this.flag,this.pos,2),this.pos+=2,t.writeUInt32LE(this.fileSize,this.pos),this.pos+=4,t.writeUInt32LE(this.reserved,this.pos),this.pos+=4,t.writeUInt32LE(this.offset,this.pos),this.pos+=4,t.writeUInt32LE(this.headerInfoSize,this.pos),this.pos+=4,t.writeUInt32LE(this.width,this.pos),this.pos+=4,t.writeInt32LE(-this.height,this.pos),this.pos+=4,t.writeUInt16LE(this.planes,this.pos),this.pos+=2,t.writeUInt16LE(this.bitPP,this.pos),this.pos+=2,t.writeUInt32LE(this.compress,this.pos),this.pos+=4,t.writeUInt32LE(this.rgbSize,this.pos),this.pos+=4,t.writeUInt32LE(this.hr,this.pos),this.pos+=4,t.writeUInt32LE(this.vr,this.pos),this.pos+=4,t.writeUInt32LE(this.colors,this.pos),this.pos+=4,t.writeUInt32LE(this.importantColors,this.pos),this.pos+=4;for(var e=0,r=3*this.width+this.extraBytes,n=0;n<this.height;n++){for(var a=0;a<this.width;a++){var o=this.pos+n*r+3*a;e++,t[o]=this.buffer[e++],t[o+1]=this.buffer[e++],t[o+2]=this.buffer[e++]}if(this.extraBytes>0){var s=this.pos+n*r+3*this.width;t.fill(0,s,s+this.extraBytes)}}return t},t.exports=function(t,e){return void 0===e&&(e=100),{data:new n(t).encode(),width:t.width,height:t.height}}},5137:(t,e,r)=>{var i=r(8834).lW;t.exports=function(t,e){if(i.isBuffer(t)&&i.isBuffer(e)){if("function"==typeof t.equals)return t.equals(e);if(t.length!==e.length)return!1;for(var r=0;r<t.length;r++)if(t[r]!==e[r])return!1;return!0}}},8834:(t,e,r)=>{"use strict";var i=r(5766),n=r(4181);e.lW=s,e.h2=50;var a=2147483647;function o(t){if(t>a)throw new RangeError('The value "'+t+'" is invalid for option "size"');var e=new Uint8Array(t);return e.__proto__=s.prototype,e}function s(t,e,r){if("number"==typeof t){if("string"==typeof e)throw new TypeError('The "string" argument must be of type string. Received type number');return f(t)}return h(t,e,r)}function h(t,e,r){if("string"==typeof t)return function(t,e){if("string"==typeof e&&""!==e||(e="utf8"),!s.isEncoding(e))throw new TypeError("Unknown encoding: "+e);var r=0|d(t,e),i=o(r),n=i.write(t,e);return n!==r&&(i=i.slice(0,n)),i}(t,e);if(ArrayBuffer.isView(t))return u(t);if(null==t)throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof t);if(F(t,ArrayBuffer)||t&&F(t.buffer,ArrayBuffer))return function(t,e,r){if(e<0||t.byteLength<e)throw new RangeError('"offset" is outside of buffer bounds');if(t.byteLength<e+(r||0))throw new RangeError('"length" is outside of buffer bounds');var i;return(i=void 0===e&&void 0===r?new Uint8Array(t):void 0===r?new Uint8Array(t,e):new Uint8Array(t,e,r)).__proto__=s.prototype,i}(t,e,r);if("number"==typeof t)throw new TypeError('The "value" argument must not be of type number. Received type number');var i=t.valueOf&&t.valueOf();if(null!=i&&i!==t)return s.from(i,e,r);var n=function(t){if(s.isBuffer(t)){var e=0|c(t.length),r=o(e);return 0===r.length||t.copy(r,0,0,e),r}return void 0!==t.length?"number"!=typeof t.length||j(t.length)?o(0):u(t):"Buffer"===t.type&&Array.isArray(t.data)?u(t.data):void 0}(t);if(n)return n;if("undefined"!=typeof Symbol&&null!=Symbol.toPrimitive&&"function"==typeof t[Symbol.toPrimitive])return s.from(t[Symbol.toPrimitive]("string"),e,r);throw new TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof t)}function l(t){if("number"!=typeof t)throw new TypeError('"size" argument must be of type number');if(t<0)throw new RangeError('The value "'+t+'" is invalid for option "size"')}function f(t){return l(t),o(t<0?0:0|c(t))}function u(t){for(var e=t.length<0?0:0|c(t.length),r=o(e),i=0;i<e;i+=1)r[i]=255&t[i];return r}function c(t){if(t>=a)throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x"+a.toString(16)+" bytes");return 0|t}function d(t,e){if(s.isBuffer(t))return t.length;if(ArrayBuffer.isView(t)||F(t,ArrayBuffer))return t.byteLength;if("string"!=typeof t)throw new TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type '+typeof t);var r=t.length,i=arguments.length>2&&!0===arguments[2];if(!i&&0===r)return 0;for(var n=!1;;)switch(e){case"ascii":case"latin1":case"binary":return r;case"utf8":case"utf-8":return z(t).length;case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return 2*r;case"hex":return r>>>1;case"base64":return D(t).length;default:if(n)return i?-1:z(t).length;e=(""+e).toLowerCase(),n=!0}}function p(t,e,r){var i=!1;if((void 0===e||e<0)&&(e=0),e>this.length)return"";if((void 0===r||r>this.length)&&(r=this.length),r<=0)return"";if((r>>>=0)<=(e>>>=0))return"";for(t||(t="utf8");;)switch(t){case"hex":return B(this,e,r);case"utf8":case"utf-8":return S(this,e,r);case"ascii":return A(this,e,r);case"latin1":case"binary":return I(this,e,r);case"base64":return k(this,e,r);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return T(this,e,r);default:if(i)throw new TypeError("Unknown encoding: "+t);t=(t+"").toLowerCase(),i=!0}}function m(t,e,r){var i=t[e];t[e]=t[r],t[r]=i}function g(t,e,r,i,n){if(0===t.length)return-1;if("string"==typeof r?(i=r,r=0):r>2147483647?r=2147483647:r<-2147483648&&(r=-2147483648),j(r=+r)&&(r=n?0:t.length-1),r<0&&(r=t.length+r),r>=t.length){if(n)return-1;r=t.length-1}else if(r<0){if(!n)return-1;r=0}if("string"==typeof e&&(e=s.from(e,i)),s.isBuffer(e))return 0===e.length?-1:b(t,e,r,i,n);if("number"==typeof e)return e&=255,"function"==typeof Uint8Array.prototype.indexOf?n?Uint8Array.prototype.indexOf.call(t,e,r):Uint8Array.prototype.lastIndexOf.call(t,e,r):b(t,[e],r,i,n);throw new TypeError("val must be string, number or Buffer")}function b(t,e,r,i,n){var a,o=1,s=t.length,h=e.length;if(void 0!==i&&("ucs2"===(i=String(i).toLowerCase())||"ucs-2"===i||"utf16le"===i||"utf-16le"===i)){if(t.length<2||e.length<2)return-1;o=2,s/=2,h/=2,r/=2}function l(t,e){return 1===o?t[e]:t.readUInt16BE(e*o)}if(n){var f=-1;for(a=r;a<s;a++)if(l(t,a)===l(e,-1===f?0:a-f)){if(-1===f&&(f=a),a-f+1===h)return f*o}else-1!==f&&(a-=a-f),f=-1}else for(r+h>s&&(r=s-h),a=r;a>=0;a--){for(var u=!0,c=0;c<h;c++)if(l(t,a+c)!==l(e,c)){u=!1;break}if(u)return a}return-1}function _(t,e,r,i){r=Number(r)||0;var n=t.length-r;i?(i=Number(i))>n&&(i=n):i=n;var a=e.length;i>a/2&&(i=a/2);for(var o=0;o<i;++o){var s=parseInt(e.substr(2*o,2),16);if(j(s))return o;t[r+o]=s}return o}function y(t,e,r,i){return N(z(e,t.length-r),t,r,i)}function w(t,e,r,i){return N(function(t){for(var e=[],r=0;r<t.length;++r)e.push(255&t.charCodeAt(r));return e}(e),t,r,i)}function v(t,e,r,i){return w(t,e,r,i)}function x(t,e,r,i){return N(D(e),t,r,i)}function E(t,e,r,i){return N(function(t,e){for(var r,i,n,a=[],o=0;o<t.length&&!((e-=2)<0);++o)i=(r=t.charCodeAt(o))>>8,n=r%256,a.push(n),a.push(i);return a}(e,t.length-r),t,r,i)}function k(t,e,r){return 0===e&&r===t.length?i.fromByteArray(t):i.fromByteArray(t.slice(e,r))}function S(t,e,r){r=Math.min(t.length,r);for(var i=[],n=e;n<r;){var a,o,s,h,l=t[n],f=null,u=l>239?4:l>223?3:l>191?2:1;if(n+u<=r)switch(u){case 1:l<128&&(f=l);break;case 2:128==(192&(a=t[n+1]))&&(h=(31&l)<<6|63&a)>127&&(f=h);break;case 3:a=t[n+1],o=t[n+2],128==(192&a)&&128==(192&o)&&(h=(15&l)<<12|(63&a)<<6|63&o)>2047&&(h<55296||h>57343)&&(f=h);break;case 4:a=t[n+1],o=t[n+2],s=t[n+3],128==(192&a)&&128==(192&o)&&128==(192&s)&&(h=(15&l)<<18|(63&a)<<12|(63&o)<<6|63&s)>65535&&h<1114112&&(f=h)}null===f?(f=65533,u=1):f>65535&&(f-=65536,i.push(f>>>10&1023|55296),f=56320|1023&f),i.push(f),n+=u}return function(t){var e=t.length;if(e<=M)return String.fromCharCode.apply(String,t);for(var r="",i=0;i<e;)r+=String.fromCharCode.apply(String,t.slice(i,i+=M));return r}(i)}s.TYPED_ARRAY_SUPPORT=function(){try{var t=new Uint8Array(1);return t.__proto__={__proto__:Uint8Array.prototype,foo:function(){return 42}},42===t.foo()}catch(t){return!1}}(),s.TYPED_ARRAY_SUPPORT||"undefined"==typeof console||"function"!=typeof console.error||console.error("This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."),Object.defineProperty(s.prototype,"parent",{enumerable:!0,get:function(){if(s.isBuffer(this))return this.buffer}}),Object.defineProperty(s.prototype,"offset",{enumerable:!0,get:function(){if(s.isBuffer(this))return this.byteOffset}}),"undefined"!=typeof Symbol&&null!=Symbol.species&&s[Symbol.species]===s&&Object.defineProperty(s,Symbol.species,{value:null,configurable:!0,enumerable:!1,writable:!1}),s.poolSize=8192,s.from=function(t,e,r){return h(t,e,r)},s.prototype.__proto__=Uint8Array.prototype,s.__proto__=Uint8Array,s.alloc=function(t,e,r){return function(t,e,r){return l(t),t<=0?o(t):void 0!==e?"string"==typeof r?o(t).fill(e,r):o(t).fill(e):o(t)}(t,e,r)},s.allocUnsafe=function(t){return f(t)},s.allocUnsafeSlow=function(t){return f(t)},s.isBuffer=function(t){return null!=t&&!0===t._isBuffer&&t!==s.prototype},s.compare=function(t,e){if(F(t,Uint8Array)&&(t=s.from(t,t.offset,t.byteLength)),F(e,Uint8Array)&&(e=s.from(e,e.offset,e.byteLength)),!s.isBuffer(t)||!s.isBuffer(e))throw new TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array');if(t===e)return 0;for(var r=t.length,i=e.length,n=0,a=Math.min(r,i);n<a;++n)if(t[n]!==e[n]){r=t[n],i=e[n];break}return r<i?-1:i<r?1:0},s.isEncoding=function(t){switch(String(t).toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"latin1":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return!0;default:return!1}},s.concat=function(t,e){if(!Array.isArray(t))throw new TypeError('"list" argument must be an Array of Buffers');if(0===t.length)return s.alloc(0);var r;if(void 0===e)for(e=0,r=0;r<t.length;++r)e+=t[r].length;var i=s.allocUnsafe(e),n=0;for(r=0;r<t.length;++r){var a=t[r];if(F(a,Uint8Array)&&(a=s.from(a)),!s.isBuffer(a))throw new TypeError('"list" argument must be an Array of Buffers');a.copy(i,n),n+=a.length}return i},s.byteLength=d,s.prototype._isBuffer=!0,s.prototype.swap16=function(){var t=this.length;if(t%2!=0)throw new RangeError("Buffer size must be a multiple of 16-bits");for(var e=0;e<t;e+=2)m(this,e,e+1);return this},s.prototype.swap32=function(){var t=this.length;if(t%4!=0)throw new RangeError("Buffer size must be a multiple of 32-bits");for(var e=0;e<t;e+=4)m(this,e,e+3),m(this,e+1,e+2);return this},s.prototype.swap64=function(){var t=this.length;if(t%8!=0)throw new RangeError("Buffer size must be a multiple of 64-bits");for(var e=0;e<t;e+=8)m(this,e,e+7),m(this,e+1,e+6),m(this,e+2,e+5),m(this,e+3,e+4);return this},s.prototype.toString=function(){var t=this.length;return 0===t?"":0===arguments.length?S(this,0,t):p.apply(this,arguments)},s.prototype.toLocaleString=s.prototype.toString,s.prototype.equals=function(t){if(!s.isBuffer(t))throw new TypeError("Argument must be a Buffer");return this===t||0===s.compare(this,t)},s.prototype.inspect=function(){var t="",r=e.h2;return t=this.toString("hex",0,r).replace(/(.{2})/g,"$1 ").trim(),this.length>r&&(t+=" ... "),"<Buffer "+t+">"},s.prototype.compare=function(t,e,r,i,n){if(F(t,Uint8Array)&&(t=s.from(t,t.offset,t.byteLength)),!s.isBuffer(t))throw new TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type '+typeof t);if(void 0===e&&(e=0),void 0===r&&(r=t?t.length:0),void 0===i&&(i=0),void 0===n&&(n=this.length),e<0||r>t.length||i<0||n>this.length)throw new RangeError("out of range index");if(i>=n&&e>=r)return 0;if(i>=n)return-1;if(e>=r)return 1;if(this===t)return 0;for(var a=(n>>>=0)-(i>>>=0),o=(r>>>=0)-(e>>>=0),h=Math.min(a,o),l=this.slice(i,n),f=t.slice(e,r),u=0;u<h;++u)if(l[u]!==f[u]){a=l[u],o=f[u];break}return a<o?-1:o<a?1:0},s.prototype.includes=function(t,e,r){return-1!==this.indexOf(t,e,r)},s.prototype.indexOf=function(t,e,r){return g(this,t,e,r,!0)},s.prototype.lastIndexOf=function(t,e,r){return g(this,t,e,r,!1)},s.prototype.write=function(t,e,r,i){if(void 0===e)i="utf8",r=this.length,e=0;else if(void 0===r&&"string"==typeof e)i=e,r=this.length,e=0;else{if(!isFinite(e))throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");e>>>=0,isFinite(r)?(r>>>=0,void 0===i&&(i="utf8")):(i=r,r=void 0)}var n=this.length-e;if((void 0===r||r>n)&&(r=n),t.length>0&&(r<0||e<0)||e>this.length)throw new RangeError("Attempt to write outside buffer bounds");i||(i="utf8");for(var a=!1;;)switch(i){case"hex":return _(this,t,e,r);case"utf8":case"utf-8":return y(this,t,e,r);case"ascii":return w(this,t,e,r);case"latin1":case"binary":return v(this,t,e,r);case"base64":return x(this,t,e,r);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return E(this,t,e,r);default:if(a)throw new TypeError("Unknown encoding: "+i);i=(""+i).toLowerCase(),a=!0}},s.prototype.toJSON=function(){return{type:"Buffer",data:Array.prototype.slice.call(this._arr||this,0)}};var M=4096;function A(t,e,r){var i="";r=Math.min(t.length,r);for(var n=e;n<r;++n)i+=String.fromCharCode(127&t[n]);return i}function I(t,e,r){var i="";r=Math.min(t.length,r);for(var n=e;n<r;++n)i+=String.fromCharCode(t[n]);return i}function B(t,e,r){var i,n=t.length;(!e||e<0)&&(e=0),(!r||r<0||r>n)&&(r=n);for(var a="",o=e;o<r;++o)a+=(i=t[o])<16?"0"+i.toString(16):i.toString(16);return a}function T(t,e,r){for(var i=t.slice(e,r),n="",a=0;a<i.length;a+=2)n+=String.fromCharCode(i[a]+256*i[a+1]);return n}function R(t,e,r){if(t%1!=0||t<0)throw new RangeError("offset is not uint");if(t+e>r)throw new RangeError("Trying to access beyond buffer length")}function P(t,e,r,i,n,a){if(!s.isBuffer(t))throw new TypeError('"buffer" argument must be a Buffer instance');if(e>n||e<a)throw new RangeError('"value" argument is out of bounds');if(r+i>t.length)throw new RangeError("Index out of range")}function O(t,e,r,i,n,a){if(r+i>t.length)throw new RangeError("Index out of range");if(r<0)throw new RangeError("Index out of range")}function L(t,e,r,i,a){return e=+e,r>>>=0,a||O(t,0,r,4),n.write(t,e,r,i,23,4),r+4}function C(t,e,r,i,a){return e=+e,r>>>=0,a||O(t,0,r,8),n.write(t,e,r,i,52,8),r+8}s.prototype.slice=function(t,e){var r=this.length;(t=~~t)<0?(t+=r)<0&&(t=0):t>r&&(t=r),(e=void 0===e?r:~~e)<0?(e+=r)<0&&(e=0):e>r&&(e=r),e<t&&(e=t);var i=this.subarray(t,e);return i.__proto__=s.prototype,i},s.prototype.readUIntLE=function(t,e,r){t>>>=0,e>>>=0,r||R(t,e,this.length);for(var i=this[t],n=1,a=0;++a<e&&(n*=256);)i+=this[t+a]*n;return i},s.prototype.readUIntBE=function(t,e,r){t>>>=0,e>>>=0,r||R(t,e,this.length);for(var i=this[t+--e],n=1;e>0&&(n*=256);)i+=this[t+--e]*n;return i},s.prototype.readUInt8=function(t,e){return t>>>=0,e||R(t,1,this.length),this[t]},s.prototype.readUInt16LE=function(t,e){return t>>>=0,e||R(t,2,this.length),this[t]|this[t+1]<<8},s.prototype.readUInt16BE=function(t,e){return t>>>=0,e||R(t,2,this.length),this[t]<<8|this[t+1]},s.prototype.readUInt32LE=function(t,e){return t>>>=0,e||R(t,4,this.length),(this[t]|this[t+1]<<8|this[t+2]<<16)+16777216*this[t+3]},s.prototype.readUInt32BE=function(t,e){return t>>>=0,e||R(t,4,this.length),16777216*this[t]+(this[t+1]<<16|this[t+2]<<8|this[t+3])},s.prototype.readIntLE=function(t,e,r){t>>>=0,e>>>=0,r||R(t,e,this.length);for(var i=this[t],n=1,a=0;++a<e&&(n*=256);)i+=this[t+a]*n;return i>=(n*=128)&&(i-=Math.pow(2,8*e)),i},s.prototype.readIntBE=function(t,e,r){t>>>=0,e>>>=0,r||R(t,e,this.length);for(var i=e,n=1,a=this[t+--i];i>0&&(n*=256);)a+=this[t+--i]*n;return a>=(n*=128)&&(a-=Math.pow(2,8*e)),a},s.prototype.readInt8=function(t,e){return t>>>=0,e||R(t,1,this.length),128&this[t]?-1*(255-this[t]+1):this[t]},s.prototype.readInt16LE=function(t,e){t>>>=0,e||R(t,2,this.length);var r=this[t]|this[t+1]<<8;return 32768&r?4294901760|r:r},s.prototype.readInt16BE=function(t,e){t>>>=0,e||R(t,2,this.length);var r=this[t+1]|this[t]<<8;return 32768&r?4294901760|r:r},s.prototype.readInt32LE=function(t,e){return t>>>=0,e||R(t,4,this.length),this[t]|this[t+1]<<8|this[t+2]<<16|this[t+3]<<24},s.prototype.readInt32BE=function(t,e){return t>>>=0,e||R(t,4,this.length),this[t]<<24|this[t+1]<<16|this[t+2]<<8|this[t+3]},s.prototype.readFloatLE=function(t,e){return t>>>=0,e||R(t,4,this.length),n.read(this,t,!0,23,4)},s.prototype.readFloatBE=function(t,e){return t>>>=0,e||R(t,4,this.length),n.read(this,t,!1,23,4)},s.prototype.readDoubleLE=function(t,e){return t>>>=0,e||R(t,8,this.length),n.read(this,t,!0,52,8)},s.prototype.readDoubleBE=function(t,e){return t>>>=0,e||R(t,8,this.length),n.read(this,t,!1,52,8)},s.prototype.writeUIntLE=function(t,e,r,i){t=+t,e>>>=0,r>>>=0,i||P(this,t,e,r,Math.pow(2,8*r)-1,0);var n=1,a=0;for(this[e]=255&t;++a<r&&(n*=256);)this[e+a]=t/n&255;return e+r},s.prototype.writeUIntBE=function(t,e,r,i){t=+t,e>>>=0,r>>>=0,i||P(this,t,e,r,Math.pow(2,8*r)-1,0);var n=r-1,a=1;for(this[e+n]=255&t;--n>=0&&(a*=256);)this[e+n]=t/a&255;return e+r},s.prototype.writeUInt8=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,1,255,0),this[e]=255&t,e+1},s.prototype.writeUInt16LE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,2,65535,0),this[e]=255&t,this[e+1]=t>>>8,e+2},s.prototype.writeUInt16BE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,2,65535,0),this[e]=t>>>8,this[e+1]=255&t,e+2},s.prototype.writeUInt32LE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,4,4294967295,0),this[e+3]=t>>>24,this[e+2]=t>>>16,this[e+1]=t>>>8,this[e]=255&t,e+4},s.prototype.writeUInt32BE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,4,4294967295,0),this[e]=t>>>24,this[e+1]=t>>>16,this[e+2]=t>>>8,this[e+3]=255&t,e+4},s.prototype.writeIntLE=function(t,e,r,i){if(t=+t,e>>>=0,!i){var n=Math.pow(2,8*r-1);P(this,t,e,r,n-1,-n)}var a=0,o=1,s=0;for(this[e]=255&t;++a<r&&(o*=256);)t<0&&0===s&&0!==this[e+a-1]&&(s=1),this[e+a]=(t/o>>0)-s&255;return e+r},s.prototype.writeIntBE=function(t,e,r,i){if(t=+t,e>>>=0,!i){var n=Math.pow(2,8*r-1);P(this,t,e,r,n-1,-n)}var a=r-1,o=1,s=0;for(this[e+a]=255&t;--a>=0&&(o*=256);)t<0&&0===s&&0!==this[e+a+1]&&(s=1),this[e+a]=(t/o>>0)-s&255;return e+r},s.prototype.writeInt8=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,1,127,-128),t<0&&(t=255+t+1),this[e]=255&t,e+1},s.prototype.writeInt16LE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,2,32767,-32768),this[e]=255&t,this[e+1]=t>>>8,e+2},s.prototype.writeInt16BE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,2,32767,-32768),this[e]=t>>>8,this[e+1]=255&t,e+2},s.prototype.writeInt32LE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,4,2147483647,-2147483648),this[e]=255&t,this[e+1]=t>>>8,this[e+2]=t>>>16,this[e+3]=t>>>24,e+4},s.prototype.writeInt32BE=function(t,e,r){return t=+t,e>>>=0,r||P(this,t,e,4,2147483647,-2147483648),t<0&&(t=4294967295+t+1),this[e]=t>>>24,this[e+1]=t>>>16,this[e+2]=t>>>8,this[e+3]=255&t,e+4},s.prototype.writeFloatLE=function(t,e,r){return L(this,t,e,!0,r)},s.prototype.writeFloatBE=function(t,e,r){return L(this,t,e,!1,r)},s.prototype.writeDoubleLE=function(t,e,r){return C(this,t,e,!0,r)},s.prototype.writeDoubleBE=function(t,e,r){return C(this,t,e,!1,r)},s.prototype.copy=function(t,e,r,i){if(!s.isBuffer(t))throw new TypeError("argument should be a Buffer");if(r||(r=0),i||0===i||(i=this.length),e>=t.length&&(e=t.length),e||(e=0),i>0&&i<r&&(i=r),i===r)return 0;if(0===t.length||0===this.length)return 0;if(e<0)throw new RangeError("targetStart out of bounds");if(r<0||r>=this.length)throw new RangeError("Index out of range");if(i<0)throw new RangeError("sourceEnd out of bounds");i>this.length&&(i=this.length),t.length-e<i-r&&(i=t.length-e+r);var n=i-r;if(this===t&&"function"==typeof Uint8Array.prototype.copyWithin)this.copyWithin(e,r,i);else if(this===t&&r<e&&e<i)for(var a=n-1;a>=0;--a)t[a+e]=this[a+r];else Uint8Array.prototype.set.call(t,this.subarray(r,i),e);return n},s.prototype.fill=function(t,e,r,i){if("string"==typeof t){if("string"==typeof e?(i=e,e=0,r=this.length):"string"==typeof r&&(i=r,r=this.length),void 0!==i&&"string"!=typeof i)throw new TypeError("encoding must be a string");if("string"==typeof i&&!s.isEncoding(i))throw new TypeError("Unknown encoding: "+i);if(1===t.length){var n=t.charCodeAt(0);("utf8"===i&&n<128||"latin1"===i)&&(t=n)}}else"number"==typeof t&&(t&=255);if(e<0||this.length<e||this.length<r)throw new RangeError("Out of range index");if(r<=e)return this;var a;if(e>>>=0,r=void 0===r?this.length:r>>>0,t||(t=0),"number"==typeof t)for(a=e;a<r;++a)this[a]=t;else{var o=s.isBuffer(t)?t:s.from(t,i),h=o.length;if(0===h)throw new TypeError('The value "'+t+'" is invalid for argument "value"');for(a=0;a<r-e;++a)this[a+e]=o[a%h]}return this};var U=/[^+/0-9A-Za-z-_]/g;function z(t,e){var r;e=e||1/0;for(var i=t.length,n=null,a=[],o=0;o<i;++o){if((r=t.charCodeAt(o))>55295&&r<57344){if(!n){if(r>56319){(e-=3)>-1&&a.push(239,191,189);continue}if(o+1===i){(e-=3)>-1&&a.push(239,191,189);continue}n=r;continue}if(r<56320){(e-=3)>-1&&a.push(239,191,189),n=r;continue}r=65536+(n-55296<<10|r-56320)}else n&&(e-=3)>-1&&a.push(239,191,189);if(n=null,r<128){if((e-=1)<0)break;a.push(r)}else if(r<2048){if((e-=2)<0)break;a.push(r>>6|192,63&r|128)}else if(r<65536){if((e-=3)<0)break;a.push(r>>12|224,r>>6&63|128,63&r|128)}else{if(!(r<1114112))throw new Error("Invalid code point");if((e-=4)<0)break;a.push(r>>18|240,r>>12&63|128,r>>6&63|128,63&r|128)}}return a}function D(t){return i.toByteArray(function(t){if((t=(t=t.split("=")[0]).trim().replace(U,"")).length<2)return"";for(;t.length%4!=0;)t+="=";return t}(t))}function N(t,e,r,i){for(var n=0;n<i&&!(n+r>=e.length||n>=t.length);++n)e[n+r]=t[n];return n}function F(t,e){return t instanceof e||null!=t&&null!=t.constructor&&null!=t.constructor.name&&t.constructor.name===e.name}function j(t){return t!=t}},4181:(t,e)=>{e.read=function(t,e,r,i,n){var a,o,s=8*n-i-1,h=(1<<s)-1,l=h>>1,f=-7,u=r?n-1:0,c=r?-1:1,d=t[e+u];for(u+=c,a=d&(1<<-f)-1,d>>=-f,f+=s;f>0;a=256*a+t[e+u],u+=c,f-=8);for(o=a&(1<<-f)-1,a>>=-f,f+=i;f>0;o=256*o+t[e+u],u+=c,f-=8);if(0===a)a=1-l;else{if(a===h)return o?NaN:1/0*(d?-1:1);o+=Math.pow(2,i),a-=l}return(d?-1:1)*o*Math.pow(2,a-i)},e.write=function(t,e,r,i,n,a){var o,s,h,l=8*a-n-1,f=(1<<l)-1,u=f>>1,c=23===n?Math.pow(2,-24)-Math.pow(2,-77):0,d=i?0:a-1,p=i?1:-1,m=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(s=isNaN(e)?1:0,o=f):(o=Math.floor(Math.log(e)/Math.LN2),e*(h=Math.pow(2,-o))<1&&(o--,h*=2),(e+=o+u>=1?c/h:c*Math.pow(2,1-u))*h>=2&&(o++,h/=2),o+u>=f?(s=0,o=f):o+u>=1?(s=(e*h-1)*Math.pow(2,n),o+=u):(s=e*Math.pow(2,u-1)*Math.pow(2,n),o=0));n>=8;t[r+d]=255&s,d+=p,s/=256,n-=8);for(o=o<<n|s,l+=n;l>0;t[r+d]=255&o,d+=p,o/=256,l-=8);t[r+d-p]|=128*m}},2699:t=>{"use strict";var e,r="object"==typeof Reflect?Reflect:null,i=r&&"function"==typeof r.apply?r.apply:function(t,e,r){return Function.prototype.apply.call(t,e,r)};e=r&&"function"==typeof r.ownKeys?r.ownKeys:Object.getOwnPropertySymbols?function(t){return Object.getOwnPropertyNames(t).concat(Object.getOwnPropertySymbols(t))}:function(t){return Object.getOwnPropertyNames(t)};var n=Number.isNaN||function(t){return t!=t};function a(){a.init.call(this)}t.exports=a,t.exports.once=function(t,e){return new Promise((function(r,i){function n(r){t.removeListener(e,a),i(r)}function a(){"function"==typeof t.removeListener&&t.removeListener("error",n),r([].slice.call(arguments))}m(t,e,a,{once:!0}),"error"!==e&&function(t,e,r){"function"==typeof t.on&&m(t,"error",e,{once:!0})}(t,n)}))},a.EventEmitter=a,a.prototype._events=void 0,a.prototype._eventsCount=0,a.prototype._maxListeners=void 0;var o=10;function s(t){if("function"!=typeof t)throw new TypeError('The "listener" argument must be of type Function. Received type '+typeof t)}function h(t){return void 0===t._maxListeners?a.defaultMaxListeners:t._maxListeners}function l(t,e,r,i){var n,a,o,l;if(s(r),void 0===(a=t._events)?(a=t._events=Object.create(null),t._eventsCount=0):(void 0!==a.newListener&&(t.emit("newListener",e,r.listener?r.listener:r),a=t._events),o=a[e]),void 0===o)o=a[e]=r,++t._eventsCount;else if("function"==typeof o?o=a[e]=i?[r,o]:[o,r]:i?o.unshift(r):o.push(r),(n=h(t))>0&&o.length>n&&!o.warned){o.warned=!0;var f=new Error("Possible EventEmitter memory leak detected. "+o.length+" "+String(e)+" listeners added. Use emitter.setMaxListeners() to increase limit");f.name="MaxListenersExceededWarning",f.emitter=t,f.type=e,f.count=o.length,l=f,console&&console.warn&&console.warn(l)}return t}function f(){if(!this.fired)return this.target.removeListener(this.type,this.wrapFn),this.fired=!0,0===arguments.length?this.listener.call(this.target):this.listener.apply(this.target,arguments)}function u(t,e,r){var i={fired:!1,wrapFn:void 0,target:t,type:e,listener:r},n=f.bind(i);return n.listener=r,i.wrapFn=n,n}function c(t,e,r){var i=t._events;if(void 0===i)return[];var n=i[e];return void 0===n?[]:"function"==typeof n?r?[n.listener||n]:[n]:r?function(t){for(var e=new Array(t.length),r=0;r<e.length;++r)e[r]=t[r].listener||t[r];return e}(n):p(n,n.length)}function d(t){var e=this._events;if(void 0!==e){var r=e[t];if("function"==typeof r)return 1;if(void 0!==r)return r.length}return 0}function p(t,e){for(var r=new Array(e),i=0;i<e;++i)r[i]=t[i];return r}function m(t,e,r,i){if("function"==typeof t.on)i.once?t.once(e,r):t.on(e,r);else{if("function"!=typeof t.addEventListener)throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type '+typeof t);t.addEventListener(e,(function n(a){i.once&&t.removeEventListener(e,n),r(a)}))}}Object.defineProperty(a,"defaultMaxListeners",{enumerable:!0,get:function(){return o},set:function(t){if("number"!=typeof t||t<0||n(t))throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received '+t+".");o=t}}),a.init=function(){void 0!==this._events&&this._events!==Object.getPrototypeOf(this)._events||(this._events=Object.create(null),this._eventsCount=0),this._maxListeners=this._maxListeners||void 0},a.prototype.setMaxListeners=function(t){if("number"!=typeof t||t<0||n(t))throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received '+t+".");return this._maxListeners=t,this},a.prototype.getMaxListeners=function(){return h(this)},a.prototype.emit=function(t){for(var e=[],r=1;r<arguments.length;r++)e.push(arguments[r]);var n="error"===t,a=this._events;if(void 0!==a)n=n&&void 0===a.error;else if(!n)return!1;if(n){var o;if(e.length>0&&(o=e[0]),o instanceof Error)throw o;var s=new Error("Unhandled error."+(o?" ("+o.message+")":""));throw s.context=o,s}var h=a[t];if(void 0===h)return!1;if("function"==typeof h)i(h,this,e);else{var l=h.length,f=p(h,l);for(r=0;r<l;++r)i(f[r],this,e)}return!0},a.prototype.addListener=function(t,e){return l(this,t,e,!1)},a.prototype.on=a.prototype.addListener,a.prototype.prependListener=function(t,e){return l(this,t,e,!0)},a.prototype.once=function(t,e){return s(e),this.on(t,u(this,t,e)),this},a.prototype.prependOnceListener=function(t,e){return s(e),this.prependListener(t,u(this,t,e)),this},a.prototype.removeListener=function(t,e){var r,i,n,a,o;if(s(e),void 0===(i=this._events))return this;if(void 0===(r=i[t]))return this;if(r===e||r.listener===e)0==--this._eventsCount?this._events=Object.create(null):(delete i[t],i.removeListener&&this.emit("removeListener",t,r.listener||e));else if("function"!=typeof r){for(n=-1,a=r.length-1;a>=0;a--)if(r[a]===e||r[a].listener===e){o=r[a].listener,n=a;break}if(n<0)return this;0===n?r.shift():function(t,e){for(;e+1<t.length;e++)t[e]=t[e+1];t.pop()}(r,n),1===r.length&&(i[t]=r[0]),void 0!==i.removeListener&&this.emit("removeListener",t,o||e)}return this},a.prototype.off=a.prototype.removeListener,a.prototype.removeAllListeners=function(t){var e,r,i;if(void 0===(r=this._events))return this;if(void 0===r.removeListener)return 0===arguments.length?(this._events=Object.create(null),this._eventsCount=0):void 0!==r[t]&&(0==--this._eventsCount?this._events=Object.create(null):delete r[t]),this;if(0===arguments.length){var n,a=Object.keys(r);for(i=0;i<a.length;++i)"removeListener"!==(n=a[i])&&this.removeAllListeners(n);return this.removeAllListeners("removeListener"),this._events=Object.create(null),this._eventsCount=0,this}if("function"==typeof(e=r[t]))this.removeListener(t,e);else if(void 0!==e)for(i=e.length-1;i>=0;i--)this.removeListener(t,e[i]);return this},a.prototype.listeners=function(t){return c(this,t,!0)},a.prototype.rawListeners=function(t){return c(this,t,!1)},a.listenerCount=function(t,e){return"function"==typeof t.listenerCount?t.listenerCount(e):d.call(t,e)},a.prototype.listenerCount=d,a.prototype.eventNames=function(){return this._eventsCount>0?e(this._events):[]}},6551:(t,e,r)=>{var i=r(453);t.exports={create:function(t,e){if(t instanceof(e=e||(0,eval)("this")).ArrayBuffer){var n=r(909);return new i(new n(t,0,t.byteLength,!0,e))}var a=r(3684);return new i(new a(t,0,t.length,!0))}}},3684:t=>{function e(t,e,r,i){this.buffer=t,this.offset=e||0,r="number"==typeof r?r:t.length,this.endPosition=this.offset+r,this.setBigEndian(i)}e.prototype={setBigEndian:function(t){this.bigEndian=!!t},nextUInt8:function(){var t=this.buffer.readUInt8(this.offset);return this.offset+=1,t},nextInt8:function(){var t=this.buffer.readInt8(this.offset);return this.offset+=1,t},nextUInt16:function(){var t=this.bigEndian?this.buffer.readUInt16BE(this.offset):this.buffer.readUInt16LE(this.offset);return this.offset+=2,t},nextUInt32:function(){var t=this.bigEndian?this.buffer.readUInt32BE(this.offset):this.buffer.readUInt32LE(this.offset);return this.offset+=4,t},nextInt16:function(){var t=this.bigEndian?this.buffer.readInt16BE(this.offset):this.buffer.readInt16LE(this.offset);return this.offset+=2,t},nextInt32:function(){var t=this.bigEndian?this.buffer.readInt32BE(this.offset):this.buffer.readInt32LE(this.offset);return this.offset+=4,t},nextFloat:function(){var t=this.bigEndian?this.buffer.readFloatBE(this.offset):this.buffer.readFloatLE(this.offset);return this.offset+=4,t},nextDouble:function(){var t=this.bigEndian?this.buffer.readDoubleBE(this.offset):this.buffer.readDoubleLE(this.offset);return this.offset+=8,t},nextBuffer:function(t){var e=this.buffer.slice(this.offset,this.offset+t);return this.offset+=t,e},remainingLength:function(){return this.endPosition-this.offset},nextString:function(t){var e=this.buffer.toString("utf8",this.offset,this.offset+t);return this.offset+=t,e},mark:function(){var t=this;return{openWithOffset:function(r){return r=(r||0)+this.offset,new e(t.buffer,r,t.endPosition-r,t.bigEndian)},offset:this.offset}},offsetFrom:function(t){return this.offset-t.offset},skip:function(t){this.offset+=t},branch:function(t,r){return r="number"==typeof r?r:this.endPosition-(this.offset+t),new e(this.buffer,this.offset+t,r,this.bigEndian)}},t.exports=e},565:t=>{function e(t){return parseInt(t,10)}var r=3600,i=60;function n(t,r){t=t.map(e),r=r.map(e);var i=t[0],n=t[1]-1,a=t[2],o=r[0],s=r[1],h=r[2];return Date.UTC(i,n,a,o,s,h,0)/1e3}function a(t){var a=t.substr(0,10).split("-"),o=t.substr(11,8).split(":"),s=t.substr(19,6).split(":").map(e),h=s[0]*r+s[1]*i,l=n(a,o);if("number"==typeof(l-=h)&&!isNaN(l))return l}function o(t){var e=t.split(" "),r=n(e[0].split(":"),e[1].split(":"));if("number"==typeof r&&!isNaN(r))return r}t.exports={parseDateWithSpecFormat:o,parseDateWithTimezoneFormat:a,parseExifDate:function(t){var e=19===t.length&&":"===t.charAt(4);return 25===t.length&&"T"===t.charAt(10)?a(t):e?o(t):void 0}}},909:t=>{function e(t,e,r,i,n,a){this.global=n,e=e||0,r=r||t.byteLength-e,this.arrayBuffer=t.slice(e,e+r),this.view=new n.DataView(this.arrayBuffer,0,this.arrayBuffer.byteLength),this.setBigEndian(i),this.offset=0,this.parentOffset=(a||0)+e}e.prototype={setBigEndian:function(t){this.littleEndian=!t},nextUInt8:function(){var t=this.view.getUint8(this.offset);return this.offset+=1,t},nextInt8:function(){var t=this.view.getInt8(this.offset);return this.offset+=1,t},nextUInt16:function(){var t=this.view.getUint16(this.offset,this.littleEndian);return this.offset+=2,t},nextUInt32:function(){var t=this.view.getUint32(this.offset,this.littleEndian);return this.offset+=4,t},nextInt16:function(){var t=this.view.getInt16(this.offset,this.littleEndian);return this.offset+=2,t},nextInt32:function(){var t=this.view.getInt32(this.offset,this.littleEndian);return this.offset+=4,t},nextFloat:function(){var t=this.view.getFloat32(this.offset,this.littleEndian);return this.offset+=4,t},nextDouble:function(){var t=this.view.getFloat64(this.offset,this.littleEndian);return this.offset+=8,t},nextBuffer:function(t){var e=this.arrayBuffer.slice(this.offset,this.offset+t);return this.offset+=t,e},remainingLength:function(){return this.arrayBuffer.byteLength-this.offset},nextString:function(t){var e=this.arrayBuffer.slice(this.offset,this.offset+t);return e=String.fromCharCode.apply(null,new this.global.Uint8Array(e)),this.offset+=t,e},mark:function(){var t=this;return{openWithOffset:function(r){return r=(r||0)+this.offset,new e(t.arrayBuffer,r,t.arrayBuffer.byteLength-r,!t.littleEndian,t.global,t.parentOffset)},offset:this.offset,getParentOffset:function(){return t.parentOffset}}},offsetFrom:function(t){return this.parentOffset+this.offset-(t.offset+t.getParentOffset())},skip:function(t){this.offset+=t},branch:function(t,r){return r="number"==typeof r?r:this.arrayBuffer.byteLength-(this.offset+t),new e(this.arrayBuffer,this.offset+t,r,!this.littleEndian,this.global,this.parentOffset)}},t.exports=e},3332:t=>{t.exports={exif:{1:"InteropIndex",2:"InteropVersion",11:"ProcessingSoftware",254:"SubfileType",255:"OldSubfileType",256:"ImageWidth",257:"ImageHeight",258:"BitsPerSample",259:"Compression",262:"PhotometricInterpretation",263:"Thresholding",264:"CellWidth",265:"CellLength",266:"FillOrder",269:"DocumentName",270:"ImageDescription",271:"Make",272:"Model",273:"StripOffsets",274:"Orientation",277:"SamplesPerPixel",278:"RowsPerStrip",279:"StripByteCounts",280:"MinSampleValue",281:"MaxSampleValue",282:"XResolution",283:"YResolution",284:"PlanarConfiguration",285:"PageName",286:"XPosition",287:"YPosition",288:"FreeOffsets",289:"FreeByteCounts",290:"GrayResponseUnit",291:"GrayResponseCurve",292:"T4Options",293:"T6Options",296:"ResolutionUnit",297:"PageNumber",300:"ColorResponseUnit",301:"TransferFunction",305:"Software",306:"ModifyDate",315:"Artist",316:"HostComputer",317:"Predictor",318:"WhitePoint",319:"PrimaryChromaticities",320:"ColorMap",321:"HalftoneHints",322:"TileWidth",323:"TileLength",324:"TileOffsets",325:"TileByteCounts",326:"BadFaxLines",327:"CleanFaxData",328:"ConsecutiveBadFaxLines",330:"SubIFD",332:"InkSet",333:"InkNames",334:"NumberofInks",336:"DotRange",337:"TargetPrinter",338:"ExtraSamples",339:"SampleFormat",340:"SMinSampleValue",341:"SMaxSampleValue",342:"TransferRange",343:"ClipPath",344:"XClipPathUnits",345:"YClipPathUnits",346:"Indexed",347:"JPEGTables",351:"OPIProxy",400:"GlobalParametersIFD",401:"ProfileType",402:"FaxProfile",403:"CodingMethods",404:"VersionYear",405:"ModeNumber",433:"Decode",434:"DefaultImageColor",435:"T82Options",437:"JPEGTables",512:"JPEGProc",513:"ThumbnailOffset",514:"ThumbnailLength",515:"JPEGRestartInterval",517:"JPEGLosslessPredictors",518:"JPEGPointTransforms",519:"JPEGQTables",520:"JPEGDCTables",521:"JPEGACTables",529:"YCbCrCoefficients",530:"YCbCrSubSampling",531:"YCbCrPositioning",532:"ReferenceBlackWhite",559:"StripRowCounts",700:"ApplicationNotes",999:"USPTOMiscellaneous",4096:"RelatedImageFileFormat",4097:"RelatedImageWidth",4098:"RelatedImageHeight",18246:"Rating",18247:"XP_DIP_XML",18248:"StitchInfo",18249:"RatingPercent",32781:"ImageID",32931:"WangTag1",32932:"WangAnnotation",32933:"WangTag3",32934:"WangTag4",32995:"Matteing",32996:"DataType",32997:"ImageDepth",32998:"TileDepth",33405:"Model2",33421:"CFARepeatPatternDim",33422:"CFAPattern2",33423:"BatteryLevel",33424:"KodakIFD",33432:"Copyright",33434:"ExposureTime",33437:"FNumber",33445:"MDFileTag",33446:"MDScalePixel",33447:"MDColorTable",33448:"MDLabName",33449:"MDSampleInfo",33450:"MDPrepDate",33451:"MDPrepTime",33452:"MDFileUnits",33550:"PixelScale",33589:"AdventScale",33590:"AdventRevision",33628:"UIC1Tag",33629:"UIC2Tag",33630:"UIC3Tag",33631:"UIC4Tag",33723:"IPTC-NAA",33918:"IntergraphPacketData",33919:"IntergraphFlagRegisters",33920:"IntergraphMatrix",33921:"INGRReserved",33922:"ModelTiePoint",34016:"Site",34017:"ColorSequence",34018:"IT8Header",34019:"RasterPadding",34020:"BitsPerRunLength",34021:"BitsPerExtendedRunLength",34022:"ColorTable",34023:"ImageColorIndicator",34024:"BackgroundColorIndicator",34025:"ImageColorValue",34026:"BackgroundColorValue",34027:"PixelIntensityRange",34028:"TransparencyIndicator",34029:"ColorCharacterization",34030:"HCUsage",34031:"TrapIndicator",34032:"CMYKEquivalent",34118:"SEMInfo",34152:"AFCP_IPTC",34232:"PixelMagicJBIGOptions",34264:"ModelTransform",34306:"WB_GRGBLevels",34310:"LeafData",34377:"PhotoshopSettings",34665:"ExifOffset",34675:"ICC_Profile",34687:"TIFF_FXExtensions",34688:"MultiProfiles",34689:"SharedData",34690:"T88Options",34732:"ImageLayer",34735:"GeoTiffDirectory",34736:"GeoTiffDoubleParams",34737:"GeoTiffAsciiParams",34850:"ExposureProgram",34852:"SpectralSensitivity",34853:"GPSInfo",34855:"ISO",34856:"Opto-ElectricConvFactor",34857:"Interlace",34858:"TimeZoneOffset",34859:"SelfTimerMode",34864:"SensitivityType",34865:"StandardOutputSensitivity",34866:"RecommendedExposureIndex",34867:"ISOSpeed",34868:"ISOSpeedLatitudeyyy",34869:"ISOSpeedLatitudezzz",34908:"FaxRecvParams",34909:"FaxSubAddress",34910:"FaxRecvTime",34954:"LeafSubIFD",36864:"ExifVersion",36867:"DateTimeOriginal",36868:"CreateDate",37121:"ComponentsConfiguration",37122:"CompressedBitsPerPixel",37377:"ShutterSpeedValue",37378:"ApertureValue",37379:"BrightnessValue",37380:"ExposureCompensation",37381:"MaxApertureValue",37382:"SubjectDistance",37383:"MeteringMode",37384:"LightSource",37385:"Flash",37386:"FocalLength",37387:"FlashEnergy",37388:"SpatialFrequencyResponse",37389:"Noise",37390:"FocalPlaneXResolution",37391:"FocalPlaneYResolution",37392:"FocalPlaneResolutionUnit",37393:"ImageNumber",37394:"SecurityClassification",37395:"ImageHistory",37396:"SubjectArea",37397:"ExposureIndex",37398:"TIFF-EPStandardID",37399:"SensingMethod",37434:"CIP3DataFile",37435:"CIP3Sheet",37436:"CIP3Side",37439:"StoNits",37500:"MakerNote",37510:"UserComment",37520:"SubSecTime",37521:"SubSecTimeOriginal",37522:"SubSecTimeDigitized",37679:"MSDocumentText",37680:"MSPropertySetStorage",37681:"MSDocumentTextPosition",37724:"ImageSourceData",40091:"XPTitle",40092:"XPComment",40093:"XPAuthor",40094:"XPKeywords",40095:"XPSubject",40960:"FlashpixVersion",40961:"ColorSpace",40962:"ExifImageWidth",40963:"ExifImageHeight",40964:"RelatedSoundFile",40965:"InteropOffset",41483:"FlashEnergy",41484:"SpatialFrequencyResponse",41485:"Noise",41486:"FocalPlaneXResolution",41487:"FocalPlaneYResolution",41488:"FocalPlaneResolutionUnit",41489:"ImageNumber",41490:"SecurityClassification",41491:"ImageHistory",41492:"SubjectLocation",41493:"ExposureIndex",41494:"TIFF-EPStandardID",41495:"SensingMethod",41728:"FileSource",41729:"SceneType",41730:"CFAPattern",41985:"CustomRendered",41986:"ExposureMode",41987:"WhiteBalance",41988:"DigitalZoomRatio",41989:"FocalLengthIn35mmFormat",41990:"SceneCaptureType",41991:"GainControl",41992:"Contrast",41993:"Saturation",41994:"Sharpness",41995:"DeviceSettingDescription",41996:"SubjectDistanceRange",42016:"ImageUniqueID",42032:"OwnerName",42033:"SerialNumber",42034:"LensInfo",42035:"LensMake",42036:"LensModel",42037:"LensSerialNumber",42112:"GDALMetadata",42113:"GDALNoData",42240:"Gamma",44992:"ExpandSoftware",44993:"ExpandLens",44994:"ExpandFilm",44995:"ExpandFilterLens",44996:"ExpandScanner",44997:"ExpandFlashLamp",48129:"PixelFormat",48130:"Transformation",48131:"Uncompressed",48132:"ImageType",48256:"ImageWidth",48257:"ImageHeight",48258:"WidthResolution",48259:"HeightResolution",48320:"ImageOffset",48321:"ImageByteCount",48322:"AlphaOffset",48323:"AlphaByteCount",48324:"ImageDataDiscard",48325:"AlphaDataDiscard",50215:"OceScanjobDesc",50216:"OceApplicationSelector",50217:"OceIDNumber",50218:"OceImageLogic",50255:"Annotations",50341:"PrintIM",50560:"USPTOOriginalContentType",50706:"DNGVersion",50707:"DNGBackwardVersion",50708:"UniqueCameraModel",50709:"LocalizedCameraModel",50710:"CFAPlaneColor",50711:"CFALayout",50712:"LinearizationTable",50713:"BlackLevelRepeatDim",50714:"BlackLevel",50715:"BlackLevelDeltaH",50716:"BlackLevelDeltaV",50717:"WhiteLevel",50718:"DefaultScale",50719:"DefaultCropOrigin",50720:"DefaultCropSize",50721:"ColorMatrix1",50722:"ColorMatrix2",50723:"CameraCalibration1",50724:"CameraCalibration2",50725:"ReductionMatrix1",50726:"ReductionMatrix2",50727:"AnalogBalance",50728:"AsShotNeutral",50729:"AsShotWhiteXY",50730:"BaselineExposure",50731:"BaselineNoise",50732:"BaselineSharpness",50733:"BayerGreenSplit",50734:"LinearResponseLimit",50735:"CameraSerialNumber",50736:"DNGLensInfo",50737:"ChromaBlurRadius",50738:"AntiAliasStrength",50739:"ShadowScale",50740:"DNGPrivateData",50741:"MakerNoteSafety",50752:"RawImageSegmentation",50778:"CalibrationIlluminant1",50779:"CalibrationIlluminant2",50780:"BestQualityScale",50781:"RawDataUniqueID",50784:"AliasLayerMetadata",50827:"OriginalRawFileName",50828:"OriginalRawFileData",50829:"ActiveArea",50830:"MaskedAreas",50831:"AsShotICCProfile",50832:"AsShotPreProfileMatrix",50833:"CurrentICCProfile",50834:"CurrentPreProfileMatrix",50879:"ColorimetricReference",50898:"PanasonicTitle",50899:"PanasonicTitle2",50931:"CameraCalibrationSig",50932:"ProfileCalibrationSig",50933:"ProfileIFD",50934:"AsShotProfileName",50935:"NoiseReductionApplied",50936:"ProfileName",50937:"ProfileHueSatMapDims",50938:"ProfileHueSatMapData1",50939:"ProfileHueSatMapData2",50940:"ProfileToneCurve",50941:"ProfileEmbedPolicy",50942:"ProfileCopyright",50964:"ForwardMatrix1",50965:"ForwardMatrix2",50966:"PreviewApplicationName",50967:"PreviewApplicationVersion",50968:"PreviewSettingsName",50969:"PreviewSettingsDigest",50970:"PreviewColorSpace",50971:"PreviewDateTime",50972:"RawImageDigest",50973:"OriginalRawFileDigest",50974:"SubTileBlockSize",50975:"RowInterleaveFactor",50981:"ProfileLookTableDims",50982:"ProfileLookTableData",51008:"OpcodeList1",51009:"OpcodeList2",51022:"OpcodeList3",51041:"NoiseProfile",51043:"TimeCodes",51044:"FrameRate",51058:"TStop",51081:"ReelName",51089:"OriginalDefaultFinalSize",51090:"OriginalBestQualitySize",51091:"OriginalDefaultCropSize",51105:"CameraLabel",51107:"ProfileHueSatMapEncoding",51108:"ProfileLookTableEncoding",51109:"BaselineExposureOffset",51110:"DefaultBlackRender",51111:"NewRawImageDigest",51112:"RawToPreviewGain",51125:"DefaultUserCrop",59932:"Padding",59933:"OffsetSchema",65e3:"OwnerName",65001:"SerialNumber",65002:"Lens",65024:"KDC_IFD",65100:"RawFile",65101:"Converter",65102:"WhiteBalance",65105:"Exposure",65106:"Shadows",65107:"Brightness",65108:"Contrast",65109:"Saturation",65110:"Sharpness",65111:"Smoothness",65112:"MoireFilter"},gps:{0:"GPSVersionID",1:"GPSLatitudeRef",2:"GPSLatitude",3:"GPSLongitudeRef",4:"GPSLongitude",5:"GPSAltitudeRef",6:"GPSAltitude",7:"GPSTimeStamp",8:"GPSSatellites",9:"GPSStatus",10:"GPSMeasureMode",11:"GPSDOP",12:"GPSSpeedRef",13:"GPSSpeed",14:"GPSTrackRef",15:"GPSTrack",16:"GPSImgDirectionRef",17:"GPSImgDirection",18:"GPSMapDatum",19:"GPSDestLatitudeRef",20:"GPSDestLatitude",21:"GPSDestLongitudeRef",22:"GPSDestLongitude",23:"GPSDestBearingRef",24:"GPSDestBearing",25:"GPSDestDistanceRef",26:"GPSDestDistance",27:"GPSProcessingMethod",28:"GPSAreaInformation",29:"GPSDateStamp",30:"GPSDifferential",31:"GPSHPositioningError"}}},592:t=>{function e(t,e){switch(t){case 1:return e.nextUInt8();case 3:case 8:return e.nextUInt16();case 4:case 9:return e.nextUInt32();case 5:return[e.nextUInt32(),e.nextUInt32()];case 6:return e.nextInt8();case 10:return[e.nextInt32(),e.nextInt32()];case 11:return e.nextFloat();case 12:return e.nextDouble();default:throw new Error("Invalid format while decoding: "+t)}}function r(t,r){var i,n,a=r.nextUInt16(),o=r.nextUInt16(),s=function(t){switch(t){case 1:case 2:case 6:case 7:return 1;case 3:case 8:return 2;case 4:case 9:case 11:return 4;case 5:case 10:case 12:return 8;default:return 0}}(o),h=r.nextUInt32(),l=s*h;if(l>4&&(r=t.openWithOffset(r.nextUInt32())),2===o){var f=(i=r.nextString(h)).indexOf("\0");-1!==f&&(i=i.substr(0,f))}else if(7===o)i=r.nextBuffer(h);else if(0!==o)for(i=[],n=0;n<h;++n)i.push(e(o,r));return l<4&&r.skip(4-l),[a,i,o]}function i(t,e,i){var n,a,o=e.nextUInt16();for(a=0;a<o;++a)i((n=r(t,e))[0],n[1],n[2])}t.exports={IFD0:1,IFD1:2,GPSIFD:3,SubIFD:4,InteropIFD:5,parseTags:function(t,e){var r,n,a,o;try{r=function(t){if("Exif\0\0"!==t.nextString(6))throw new Error("Invalid EXIF header");var e=t.mark(),r=t.nextUInt16();if(18761===r)t.setBigEndian(!1);else{if(19789!==r)throw new Error("Invalid TIFF header");t.setBigEndian(!0)}if(42!==t.nextUInt16())throw new Error("Invalid TIFF data");return e}(t)}catch(t){return!1}var s=r.openWithOffset(t.nextUInt32()),h=this.IFD0;i(r,s,(function(t,r,i){switch(t){case 34853:a=r[0];break;case 34665:n=r[0];break;default:e(h,t,r,i)}}));var l=s.nextUInt32();if(0!==l){var f=r.openWithOffset(l);i(r,f,e.bind(null,this.IFD1))}if(a){var u=r.openWithOffset(a);i(r,u,e.bind(null,this.GPSIFD))}if(n){var c=r.openWithOffset(n),d=this.InteropIFD;i(r,c,(function(t,r,i){40965===t?o=r[0]:e(d,t,r,i)}))}if(o){var p=r.openWithOffset(o);i(r,p,e.bind(null,this.InteropIFD))}return!0}}},656:t=>{t.exports={parseSections:function(t,e){var r,i;for(t.setBigEndian(!0);t.remainingLength()>0&&218!==i;){if(255!==t.nextUInt8())throw new Error("Invalid JPEG section offset");r=(i=t.nextUInt8())>=208&&i<=217||218===i?0:t.nextUInt16()-2,e(i,t.branch(0,r)),t.skip(r)}},getSizeFromSOFSection:function(t){return t.skip(1),{height:t.nextUInt16(),width:t.nextUInt16()}},getSectionName:function(t){var e,r;switch(t){case 216:e="SOI";break;case 196:e="DHT";break;case 219:e="DQT";break;case 221:e="DRI";break;case 218:e="SOS";break;case 254:e="COM";break;case 217:e="EOI";break;default:t>=224&&t<=239?(e="APP",r=t-224):t>=192&&t<=207&&196!==t&&200!==t&&204!==t?(e="SOF",r=t-192):t>=208&&t<=215&&(e="RST",r=t-208)}var i={name:e};return"number"==typeof r&&(i.index=r),i}}},453:(t,e,r)=>{var i=r(656),n=r(592),a=r(3814);function o(t,e,r,i,n,a,o){this.startMarker=t,this.tags=e,this.imageSize=r,this.thumbnailOffset=i,this.thumbnailLength=n,this.thumbnailType=a,this.app1Offset=o}function s(t){this.stream=t,this.flags={readBinaryTags:!1,resolveTagNames:!0,simplifyValues:!0,imageSize:!0,hidePointers:!0,returnTags:!0}}o.prototype={hasThumbnail:function(t){return!(!this.thumbnailOffset||!this.thumbnailLength||"string"==typeof t&&("image/jpeg"===t.toLowerCase().trim()?6!==this.thumbnailType:"image/tiff"!==t.toLowerCase().trim()||1!==this.thumbnailType))},getThumbnailOffset:function(){return this.app1Offset+6+this.thumbnailOffset},getThumbnailLength:function(){return this.thumbnailLength},getThumbnailBuffer:function(){return this._getThumbnailStream().nextBuffer(this.thumbnailLength)},_getThumbnailStream:function(){return this.startMarker.openWithOffset(this.getThumbnailOffset())},getImageSize:function(){return this.imageSize},getThumbnailSize:function(){var t,e=this._getThumbnailStream();return i.parseSections(e,(function(e,r){"SOF"===i.getSectionName(e).name&&(t=i.getSizeFromSOFSection(r))})),t}},s.prototype={enableBinaryFields:function(t){return this.flags.readBinaryTags=!!t,this},enablePointers:function(t){return this.flags.hidePointers=!t,this},enableTagNames:function(t){return this.flags.resolveTagNames=!!t,this},enableImageSize:function(t){return this.flags.imageSize=!!t,this},enableReturnTags:function(t){return this.flags.returnTags=!!t,this},enableSimpleValues:function(t){return this.flags.simplifyValues=!!t,this},parse:function(){var t,e,s,h,l,f,u,c,d,p=this.stream.mark(),m=p.openWithOffset(0),g=this.flags;return g.resolveTagNames&&(u=r(3332)),g.resolveTagNames?(t={},c=function(e){return t[e.name]},d=function(e,r){t[e.name]=r}):(t=[],c=function(e){var r;for(r=0;r<t.length;++r)if(t[r].type===e.type&&t[r].section===e.section)return t.value},d=function(e,r){var i;for(i=0;i<t.length;++i)if(t[i].type===e.type&&t[i].section===e.section)return void(t.value=r)}),i.parseSections(m,(function(r,o){var c=o.offsetFrom(p);225===r?n.parseTags(o,(function(e,r,i,o){if(g.readBinaryTags||7!==o){if(513===r){if(s=i[0],g.hidePointers)return}else if(514===r){if(h=i[0],g.hidePointers)return}else if(259===r&&(l=i[0],g.hidePointers))return;if(g.returnTags)if(g.simplifyValues&&(i=a.simplifyValue(i,o)),g.resolveTagNames){var f=(e===n.GPSIFD?u.gps:u.exif)[r];f||(f=u.exif[r]),t.hasOwnProperty(f)||(t[f]=i)}else t.push({section:e,type:r,value:i})}}))&&(f=c):g.imageSize&&"SOF"===i.getSectionName(r).name&&(e=i.getSizeFromSOFSection(o))})),g.simplifyValues&&(a.castDegreeValues(c,d),a.castDateValues(c,d)),new o(p,t,e,s,h,l,f)}},t.exports=s},3814:(t,e,r)=>{var i=r(592),n=r(565),a=[{section:i.GPSIFD,type:2,name:"GPSLatitude",refType:1,refName:"GPSLatitudeRef",posVal:"N"},{section:i.GPSIFD,type:4,name:"GPSLongitude",refType:3,refName:"GPSLongitudeRef",posVal:"E"}],o=[{section:i.SubIFD,type:306,name:"ModifyDate"},{section:i.SubIFD,type:36867,name:"DateTimeOriginal"},{section:i.SubIFD,type:36868,name:"CreateDate"},{section:i.SubIFD,type:306,name:"ModifyDate"}];t.exports={castDegreeValues:function(t,e){a.forEach((function(r){var i=t(r);if(i){var n=t({section:r.section,type:r.refType,name:r.refName})===r.posVal?1:-1,a=(i[0]+i[1]/60+i[2]/3600)*n;e(r,a)}}))},castDateValues:function(t,e){o.forEach((function(r){var i=t(r);if(i){var a=n.parseExifDate(i);void 0!==a&&e(r,a)}}))},simplifyValue:function(t,e){return Array.isArray(t)&&1===(t=t.map((function(t){return 10===e||5===e?t[0]/t[1]:t}))).length&&(t=t[0]),t}}},8789:(module,__unused_webpack_exports,__webpack_require__)=>{"use strict";var Buffer=__webpack_require__(8834).lW;const Token=__webpack_require__(5010),strtok3=__webpack_require__(7378),{stringToBytes,tarHeaderChecksumMatches,uint32SyncSafeToken}=__webpack_require__(7044),supported=__webpack_require__(4078),minimumBytes=4100;async function fromStream(t){const e=await strtok3.fromStream(t);try{return await fromTokenizer(e)}finally{await e.close()}}async function fromBuffer(t){if(!(t instanceof Uint8Array||t instanceof ArrayBuffer||Buffer.isBuffer(t)))throw new TypeError(`Expected the \`input\` argument to be of type \`Uint8Array\` or \`Buffer\` or \`ArrayBuffer\`, got \`${typeof t}\``);const e=t instanceof Buffer?t:Buffer.from(t);if(e&&e.length>1)return fromTokenizer(strtok3.fromBuffer(e))}function _check(t,e,r){r={offset:0,...r};for(const[i,n]of e.entries())if(r.mask){if(n!==(r.mask[i]&t[i+r.offset]))return!1}else if(n!==t[i+r.offset])return!1;return!0}async function fromTokenizer(t){try{return _fromTokenizer(t)}catch(t){if(!(t instanceof strtok3.EndOfStreamError))throw t}}async function _fromTokenizer(t){let e=Buffer.alloc(minimumBytes);const r=(t,r)=>_check(e,t,r),i=(t,e)=>r(stringToBytes(t),e);if(t.fileInfo.size||(t.fileInfo.size=Number.MAX_SAFE_INTEGER),await t.peekBuffer(e,{length:12,mayBeLess:!0}),r([66,77]))return{ext:"bmp",mime:"image/bmp"};if(r([11,119]))return{ext:"ac3",mime:"audio/vnd.dolby.dd-raw"};if(r([120,1]))return{ext:"dmg",mime:"application/x-apple-diskimage"};if(r([77,90]))return{ext:"exe",mime:"application/x-msdownload"};if(r([37,33]))return await t.peekBuffer(e,{length:24,mayBeLess:!0}),i("PS-Adobe-",{offset:2})&&i(" EPSF-",{offset:14})?{ext:"eps",mime:"application/eps"}:{ext:"ps",mime:"application/postscript"};if(r([31,160])||r([31,157]))return{ext:"Z",mime:"application/x-compress"};if(r([255,216,255]))return{ext:"jpg",mime:"image/jpeg"};if(r([73,73,188]))return{ext:"jxr",mime:"image/vnd.ms-photo"};if(r([31,139,8]))return{ext:"gz",mime:"application/gzip"};if(r([66,90,104]))return{ext:"bz2",mime:"application/x-bzip2"};if(i("ID3")){await t.ignore(6);const n=await t.readToken(uint32SyncSafeToken);return t.position+n>t.fileInfo.size?{ext:"mp3",mime:"audio/mpeg"}:(await t.ignore(n),fromTokenizer(t))}if(i("MP+"))return{ext:"mpc",mime:"audio/x-musepack"};if((67===e[0]||70===e[0])&&r([87,83],{offset:1}))return{ext:"swf",mime:"application/x-shockwave-flash"};if(r([71,73,70]))return{ext:"gif",mime:"image/gif"};if(i("FLIF"))return{ext:"flif",mime:"image/flif"};if(i("8BPS"))return{ext:"psd",mime:"image/vnd.adobe.photoshop"};if(i("WEBP",{offset:8}))return{ext:"webp",mime:"image/webp"};if(i("MPCK"))return{ext:"mpc",mime:"audio/x-musepack"};if(i("FORM"))return{ext:"aif",mime:"audio/aiff"};if(i("icns",{offset:0}))return{ext:"icns",mime:"image/icns"};if(r([80,75,3,4])){try{for(;t.position+30<t.fileInfo.size;){await t.readBuffer(e,{length:30});const a={compressedSize:e.readUInt32LE(18),uncompressedSize:e.readUInt32LE(22),filenameLength:e.readUInt16LE(26),extraFieldLength:e.readUInt16LE(28)};if(a.filename=await t.readToken(new Token.StringType(a.filenameLength,"utf-8")),await t.ignore(a.extraFieldLength),"META-INF/mozilla.rsa"===a.filename)return{ext:"xpi",mime:"application/x-xpinstall"};if(a.filename.endsWith(".rels")||a.filename.endsWith(".xml"))switch(a.filename.split("/")[0]){case"_rels":default:break;case"word":return{ext:"docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};case"ppt":return{ext:"pptx",mime:"application/vnd.openxmlformats-officedocument.presentationml.presentation"};case"xl":return{ext:"xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}}if(a.filename.startsWith("xl/"))return{ext:"xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};if(a.filename.startsWith("3D/")&&a.filename.endsWith(".model"))return{ext:"3mf",mime:"model/3mf"};if("mimetype"===a.filename&&a.compressedSize===a.uncompressedSize)switch(await t.readToken(new Token.StringType(a.compressedSize,"utf-8"))){case"application/epub+zip":return{ext:"epub",mime:"application/epub+zip"};case"application/vnd.oasis.opendocument.text":return{ext:"odt",mime:"application/vnd.oasis.opendocument.text"};case"application/vnd.oasis.opendocument.spreadsheet":return{ext:"ods",mime:"application/vnd.oasis.opendocument.spreadsheet"};case"application/vnd.oasis.opendocument.presentation":return{ext:"odp",mime:"application/vnd.oasis.opendocument.presentation"}}if(0===a.compressedSize){let o=-1;for(;o<0&&t.position<t.fileInfo.size;)await t.peekBuffer(e,{mayBeLess:!0}),o=e.indexOf("504B0304",0,"hex"),await t.ignore(o>=0?o:e.length)}else await t.ignore(a.compressedSize)}}catch(s){if(!(s instanceof strtok3.EndOfStreamError))throw s}return{ext:"zip",mime:"application/zip"}}if(i("OggS")){await t.ignore(28);const h=Buffer.alloc(8);return await t.readBuffer(h),_check(h,[79,112,117,115,72,101,97,100])?{ext:"opus",mime:"audio/opus"}:_check(h,[128,116,104,101,111,114,97])?{ext:"ogv",mime:"video/ogg"}:_check(h,[1,118,105,100,101,111,0])?{ext:"ogm",mime:"video/ogg"}:_check(h,[127,70,76,65,67])?{ext:"oga",mime:"audio/ogg"}:_check(h,[83,112,101,101,120,32,32])?{ext:"spx",mime:"audio/ogg"}:_check(h,[1,118,111,114,98,105,115])?{ext:"ogg",mime:"audio/ogg"}:{ext:"ogx",mime:"application/ogg"}}if(r([80,75])&&(3===e[2]||5===e[2]||7===e[2])&&(4===e[3]||6===e[3]||8===e[3]))return{ext:"zip",mime:"application/zip"};if(i("ftyp",{offset:4})&&0!=(96&e[8])){const l=e.toString("binary",8,12).replace("\0"," ").trim();switch(l){case"avif":return{ext:"avif",mime:"image/avif"};case"mif1":return{ext:"heic",mime:"image/heif"};case"msf1":return{ext:"heic",mime:"image/heif-sequence"};case"heic":case"heix":return{ext:"heic",mime:"image/heic"};case"hevc":case"hevx":return{ext:"heic",mime:"image/heic-sequence"};case"qt":return{ext:"mov",mime:"video/quicktime"};case"M4V":case"M4VH":case"M4VP":return{ext:"m4v",mime:"video/x-m4v"};case"M4P":return{ext:"m4p",mime:"video/mp4"};case"M4B":return{ext:"m4b",mime:"audio/mp4"};case"M4A":return{ext:"m4a",mime:"audio/x-m4a"};case"F4V":return{ext:"f4v",mime:"video/mp4"};case"F4P":return{ext:"f4p",mime:"video/mp4"};case"F4A":return{ext:"f4a",mime:"audio/mp4"};case"F4B":return{ext:"f4b",mime:"audio/mp4"};case"crx":return{ext:"cr3",mime:"image/x-canon-cr3"};default:return l.startsWith("3g")?l.startsWith("3g2")?{ext:"3g2",mime:"video/3gpp2"}:{ext:"3gp",mime:"video/3gpp"}:{ext:"mp4",mime:"video/mp4"}}}if(i("MThd"))return{ext:"mid",mime:"audio/midi"};if(i("wOFF")&&(r([0,1,0,0],{offset:4})||i("OTTO",{offset:4})))return{ext:"woff",mime:"font/woff"};if(i("wOF2")&&(r([0,1,0,0],{offset:4})||i("OTTO",{offset:4})))return{ext:"woff2",mime:"font/woff2"};if(r([212,195,178,161])||r([161,178,195,212]))return{ext:"pcap",mime:"application/vnd.tcpdump.pcap"};if(i("DSD "))return{ext:"dsf",mime:"audio/x-dsf"};if(i("LZIP"))return{ext:"lz",mime:"application/x-lzip"};if(i("fLaC"))return{ext:"flac",mime:"audio/x-flac"};if(r([66,80,71,251]))return{ext:"bpg",mime:"image/bpg"};if(i("wvpk"))return{ext:"wv",mime:"audio/wavpack"};if(i("%PDF")){await t.ignore(1350);const f=10485760,u=Buffer.alloc(Math.min(f,t.fileInfo.size));return await t.readBuffer(u,{mayBeLess:!0}),u.includes(Buffer.from("AIPrivateData"))?{ext:"ai",mime:"application/postscript"}:{ext:"pdf",mime:"application/pdf"}}if(r([0,97,115,109]))return{ext:"wasm",mime:"application/wasm"};if(r([73,73,42,0]))return i("CR",{offset:8})?{ext:"cr2",mime:"image/x-canon-cr2"}:r([28,0,254,0],{offset:8})||r([31,0,11,0],{offset:8})?{ext:"nef",mime:"image/x-nikon-nef"}:r([8,0,0,0],{offset:4})&&(r([45,0,254,0],{offset:8})||r([39,0,254,0],{offset:8}))?{ext:"dng",mime:"image/x-adobe-dng"}:(e=Buffer.alloc(24),await t.peekBuffer(e),(r([16,251,134,1],{offset:4})||r([8,0,0,0],{offset:4}))&&r([0,254,0,4,0,1,0,0,0,1,0,0,0,3,1],{offset:9})?{ext:"arw",mime:"image/x-sony-arw"}:{ext:"tif",mime:"image/tiff"});if(r([77,77,0,42]))return{ext:"tif",mime:"image/tiff"};if(i("MAC "))return{ext:"ape",mime:"audio/ape"};if(r([26,69,223,163])){async function c(){const e=await t.peekNumber(Token.UINT8);let r=128,i=0;for(;0==(e&r)&&0!==r;)++i,r>>=1;const n=Buffer.alloc(i+1);return await t.readBuffer(n),n}async function d(){const t=await c(),e=await c();e[0]^=128>>e.length-1;const r=Math.min(6,e.length);return{id:t.readUIntBE(0,t.length),len:e.readUIntBE(e.length-r,r)}}async function p(e,r){for(;r>0;){const e=await d();if(17026===e.id)return t.readToken(new Token.StringType(e.len,"utf-8"));await t.ignore(e.len),--r}}const m=await d();switch(await p(0,m.len)){case"webm":return{ext:"webm",mime:"video/webm"};case"matroska":return{ext:"mkv",mime:"video/x-matroska"};default:return}}if(r([82,73,70,70])){if(r([65,86,73],{offset:8}))return{ext:"avi",mime:"video/vnd.avi"};if(r([87,65,86,69],{offset:8}))return{ext:"wav",mime:"audio/vnd.wave"};if(r([81,76,67,77],{offset:8}))return{ext:"qcp",mime:"audio/qcelp"}}if(i("SQLi"))return{ext:"sqlite",mime:"application/x-sqlite3"};if(r([78,69,83,26]))return{ext:"nes",mime:"application/x-nintendo-nes-rom"};if(i("Cr24"))return{ext:"crx",mime:"application/x-google-chrome-extension"};if(i("MSCF")||i("ISc("))return{ext:"cab",mime:"application/vnd.ms-cab-compressed"};if(r([237,171,238,219]))return{ext:"rpm",mime:"application/x-rpm"};if(r([197,208,211,198]))return{ext:"eps",mime:"application/eps"};if(r([40,181,47,253]))return{ext:"zst",mime:"application/zstd"};if(r([79,84,84,79,0]))return{ext:"otf",mime:"font/otf"};if(i("#!AMR"))return{ext:"amr",mime:"audio/amr"};if(i("{\\rtf"))return{ext:"rtf",mime:"application/rtf"};if(r([70,76,86,1]))return{ext:"flv",mime:"video/x-flv"};if(i("IMPM"))return{ext:"it",mime:"audio/x-it"};if(i("-lh0-",{offset:2})||i("-lh1-",{offset:2})||i("-lh2-",{offset:2})||i("-lh3-",{offset:2})||i("-lh4-",{offset:2})||i("-lh5-",{offset:2})||i("-lh6-",{offset:2})||i("-lh7-",{offset:2})||i("-lzs-",{offset:2})||i("-lz4-",{offset:2})||i("-lz5-",{offset:2})||i("-lhd-",{offset:2}))return{ext:"lzh",mime:"application/x-lzh-compressed"};if(r([0,0,1,186])){if(r([33],{offset:4,mask:[241]}))return{ext:"mpg",mime:"video/MP1S"};if(r([68],{offset:4,mask:[196]}))return{ext:"mpg",mime:"video/MP2P"}}if(i("ITSF"))return{ext:"chm",mime:"application/vnd.ms-htmlhelp"};if(r([253,55,122,88,90,0]))return{ext:"xz",mime:"application/x-xz"};if(i("<?xml "))return{ext:"xml",mime:"application/xml"};if(r([55,122,188,175,39,28]))return{ext:"7z",mime:"application/x-7z-compressed"};if(r([82,97,114,33,26,7])&&(0===e[6]||1===e[6]))return{ext:"rar",mime:"application/x-rar-compressed"};if(i("solid "))return{ext:"stl",mime:"model/stl"};if(i("BLENDER"))return{ext:"blend",mime:"application/x-blender"};if(i("!<arch>"))return await t.ignore(8),"debian-binary"===await t.readToken(new Token.StringType(13,"ascii"))?{ext:"deb",mime:"application/x-deb"}:{ext:"ar",mime:"application/x-unix-archive"};if(r([137,80,78,71,13,10,26,10])){async function g(){return{length:await t.readToken(Token.INT32_BE),type:await t.readToken(new Token.StringType(4,"binary"))}}await t.ignore(8);do{const b=await g();if(b.length<0)return;switch(b.type){case"IDAT":return{ext:"png",mime:"image/png"};case"acTL":return{ext:"apng",mime:"image/apng"};default:await t.ignore(b.length+4)}}while(t.position+8<t.fileInfo.size);return{ext:"png",mime:"image/png"}}if(r([65,82,82,79,87,49,0,0]))return{ext:"arrow",mime:"application/x-apache-arrow"};if(r([103,108,84,70,2,0,0,0]))return{ext:"glb",mime:"model/gltf-binary"};if(r([102,114,101,101],{offset:4})||r([109,100,97,116],{offset:4})||r([109,111,111,118],{offset:4})||r([119,105,100,101],{offset:4}))return{ext:"mov",mime:"video/quicktime"};if(r([73,73,82,79,8,0,0,0,24]))return{ext:"orf",mime:"image/x-olympus-orf"};if(i("gimp xcf "))return{ext:"xcf",mime:"image/x-xcf"};if(r([73,73,85,0,24,0,0,0,136,231,116,216]))return{ext:"rw2",mime:"image/x-panasonic-rw2"};if(r([48,38,178,117,142,102,207,17,166,217])){async function _(){const e=Buffer.alloc(16);return await t.readBuffer(e),{id:e,size:Number(await t.readToken(Token.UINT64_LE))}}for(await t.ignore(30);t.position+24<t.fileInfo.size;){const y=await _();let w=y.size-24;if(_check(y.id,[145,7,220,183,183,169,207,17,142,230,0,192,12,32,83,101])){const v=Buffer.alloc(16);if(w-=await t.readBuffer(v),_check(v,[64,158,105,248,77,91,207,17,168,253,0,128,95,92,68,43]))return{ext:"asf",mime:"audio/x-ms-asf"};if(_check(v,[192,239,25,188,77,91,207,17,168,253,0,128,95,92,68,43]))return{ext:"asf",mime:"video/x-ms-asf"};break}await t.ignore(w)}return{ext:"asf",mime:"application/vnd.ms-asf"}}if(r([171,75,84,88,32,49,49,187,13,10,26,10]))return{ext:"ktx",mime:"image/ktx"};if((r([126,16,4])||r([126,24,4]))&&r([48,77,73,69],{offset:4}))return{ext:"mie",mime:"application/x-mie"};if(r([39,10,0,0,0,0,0,0,0,0,0,0],{offset:2}))return{ext:"shp",mime:"application/x-esri-shape"};if(r([0,0,0,12,106,80,32,32,13,10,135,10]))switch(await t.ignore(20),await t.readToken(new Token.StringType(4,"ascii"))){case"jp2 ":return{ext:"jp2",mime:"image/jp2"};case"jpx ":return{ext:"jpx",mime:"image/jpx"};case"jpm ":return{ext:"jpm",mime:"image/jpm"};case"mjp2":return{ext:"mj2",mime:"image/mj2"};default:return}if(r([255,10])||r([0,0,0,12,74,88,76,32,13,10,135,10]))return{ext:"jxl",mime:"image/jxl"};if(r([0,0,1,186])||r([0,0,1,179]))return{ext:"mpg",mime:"video/mpeg"};if(r([0,1,0,0,0]))return{ext:"ttf",mime:"font/ttf"};if(r([0,0,1,0]))return{ext:"ico",mime:"image/x-icon"};if(r([0,0,2,0]))return{ext:"cur",mime:"image/x-icon"};if(r([208,207,17,224,161,177,26,225]))return{ext:"cfb",mime:"application/x-cfb"};if(await t.peekBuffer(e,{length:Math.min(256,t.fileInfo.size),mayBeLess:!0}),i("BEGIN:")){if(i("VCARD",{offset:6}))return{ext:"vcf",mime:"text/vcard"};if(i("VCALENDAR",{offset:6}))return{ext:"ics",mime:"text/calendar"}}if(i("FUJIFILMCCD-RAW"))return{ext:"raf",mime:"image/x-fujifilm-raf"};if(i("Extended Module:"))return{ext:"xm",mime:"audio/x-xm"};if(i("Creative Voice File"))return{ext:"voc",mime:"audio/x-voc"};if(r([4,0,0,0])&&e.length>=16){const x=e.readUInt32LE(12);if(x>12&&e.length>=x+16)try{const E=e.slice(16,x+16).toString();if(JSON.parse(E).files)return{ext:"asar",mime:"application/x-asar"}}catch(k){}}if(r([6,14,43,52,2,5,1,1,13,1,2,1,1,2]))return{ext:"mxf",mime:"application/mxf"};if(i("SCRM",{offset:44}))return{ext:"s3m",mime:"audio/x-s3m"};if(r([71],{offset:4})&&(r([71],{offset:192})||r([71],{offset:196})))return{ext:"mts",mime:"video/mp2t"};if(r([66,79,79,75,77,79,66,73],{offset:60}))return{ext:"mobi",mime:"application/x-mobipocket-ebook"};if(r([68,73,67,77],{offset:128}))return{ext:"dcm",mime:"application/dicom"};if(r([76,0,0,0,1,20,2,0,0,0,0,0,192,0,0,0,0,0,0,70]))return{ext:"lnk",mime:"application/x.ms.shortcut"};if(r([98,111,111,107,0,0,0,0,109,97,114,107,0,0,0,0]))return{ext:"alias",mime:"application/x.apple.alias"};if(r([76,80],{offset:34})&&(r([0,0,1],{offset:8})||r([1,0,2],{offset:8})||r([2,0,2],{offset:8})))return{ext:"eot",mime:"application/vnd.ms-fontobject"};if(r([6,6,237,245,216,29,70,229,189,49,239,231,254,116,183,29]))return{ext:"indd",mime:"application/x-indesign"};if(await t.peekBuffer(e,{length:Math.min(512,t.fileInfo.size),mayBeLess:!0}),tarHeaderChecksumMatches(e))return{ext:"tar",mime:"application/x-tar"};if(r([255,254,255,14,83,0,107,0,101,0,116,0,99,0,104,0,85,0,112,0,32,0,77,0,111,0,100,0,101,0,108,0]))return{ext:"skp",mime:"application/vnd.sketchup.skp"};if(i("-----BEGIN PGP MESSAGE-----"))return{ext:"pgp",mime:"application/pgp-encrypted"};if(e.length>=2&&r([255,224],{offset:0,mask:[255,224]})){if(r([16],{offset:1,mask:[22]}))return r([8],{offset:1,mask:[8]}),{ext:"aac",mime:"audio/aac"};if(r([2],{offset:1,mask:[6]}))return{ext:"mp3",mime:"audio/mpeg"};if(r([4],{offset:1,mask:[6]}))return{ext:"mp2",mime:"audio/mpeg"};if(r([6],{offset:1,mask:[6]}))return{ext:"mp1",mime:"audio/mpeg"}}}const stream=readableStream=>new Promise(((resolve,reject)=>{const stream=eval("require")("stream");readableStream.on("error",reject),readableStream.once("readable",(async()=>{const t=new stream.PassThrough;let e;e=stream.pipeline?stream.pipeline(readableStream,t,(()=>{})):readableStream.pipe(t);const r=readableStream.read(minimumBytes)||readableStream.read()||Buffer.alloc(0);try{const e=await fromBuffer(r);t.fileType=e}catch(t){reject(t)}resolve(e)}))})),fileType={fromStream,fromTokenizer,fromBuffer,stream};Object.defineProperty(fileType,"extensions",{get:()=>new Set(supported.extensions)}),Object.defineProperty(fileType,"mimeTypes",{get:()=>new Set(supported.mimeTypes)}),module.exports=fileType},5025:(t,e,r)=>{"use strict";const i=r(3569),n=r(8789),a={fromFile:async function(t){const e=await i.fromFile(t);try{return await n.fromTokenizer(e)}finally{await e.close()}}};Object.assign(a,n),Object.defineProperty(a,"extensions",{get:()=>n.extensions}),Object.defineProperty(a,"mimeTypes",{get:()=>n.mimeTypes}),t.exports=a},4078:t=>{"use strict";t.exports={extensions:["jpg","png","apng","gif","webp","flif","xcf","cr2","cr3","orf","arw","dng","nef","rw2","raf","tif","bmp","icns","jxr","psd","indd","zip","tar","rar","gz","bz2","7z","dmg","mp4","mid","mkv","webm","mov","avi","mpg","mp2","mp3","m4a","oga","ogg","ogv","opus","flac","wav","spx","amr","pdf","epub","exe","swf","rtf","wasm","woff","woff2","eot","ttf","otf","ico","flv","ps","xz","sqlite","nes","crx","xpi","cab","deb","ar","rpm","Z","lz","cfb","mxf","mts","blend","bpg","docx","pptx","xlsx","3gp","3g2","jp2","jpm","jpx","mj2","aif","qcp","odt","ods","odp","xml","mobi","heic","cur","ktx","ape","wv","dcm","ics","glb","pcap","dsf","lnk","alias","voc","ac3","m4v","m4p","m4b","f4v","f4p","f4b","f4a","mie","asf","ogm","ogx","mpc","arrow","shp","aac","mp1","it","s3m","xm","ai","skp","avif","eps","lzh","pgp","asar","stl","chm","3mf","zst","jxl","vcf"],mimeTypes:["image/jpeg","image/png","image/gif","image/webp","image/flif","image/x-xcf","image/x-canon-cr2","image/x-canon-cr3","image/tiff","image/bmp","image/vnd.ms-photo","image/vnd.adobe.photoshop","application/x-indesign","application/epub+zip","application/x-xpinstall","application/vnd.oasis.opendocument.text","application/vnd.oasis.opendocument.spreadsheet","application/vnd.oasis.opendocument.presentation","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/zip","application/x-tar","application/x-rar-compressed","application/gzip","application/x-bzip2","application/x-7z-compressed","application/x-apple-diskimage","application/x-apache-arrow","video/mp4","audio/midi","video/x-matroska","video/webm","video/quicktime","video/vnd.avi","audio/vnd.wave","audio/qcelp","audio/x-ms-asf","video/x-ms-asf","application/vnd.ms-asf","video/mpeg","video/3gpp","audio/mpeg","audio/mp4","audio/opus","video/ogg","audio/ogg","application/ogg","audio/x-flac","audio/ape","audio/wavpack","audio/amr","application/pdf","application/x-msdownload","application/x-shockwave-flash","application/rtf","application/wasm","font/woff","font/woff2","application/vnd.ms-fontobject","font/ttf","font/otf","image/x-icon","video/x-flv","application/postscript","application/eps","application/x-xz","application/x-sqlite3","application/x-nintendo-nes-rom","application/x-google-chrome-extension","application/vnd.ms-cab-compressed","application/x-deb","application/x-unix-archive","application/x-rpm","application/x-compress","application/x-lzip","application/x-cfb","application/x-mie","application/mxf","video/mp2t","application/x-blender","image/bpg","image/jp2","image/jpx","image/jpm","image/mj2","audio/aiff","application/xml","application/x-mobipocket-ebook","image/heif","image/heif-sequence","image/heic","image/heic-sequence","image/icns","image/ktx","application/dicom","audio/x-musepack","text/calendar","text/vcard","model/gltf-binary","application/vnd.tcpdump.pcap","audio/x-dsf","application/x.ms.shortcut","application/x.apple.alias","audio/x-voc","audio/vnd.dolby.dd-raw","audio/x-m4a","image/apng","image/x-olympus-orf","image/x-sony-arw","image/x-adobe-dng","image/x-nikon-nef","image/x-panasonic-rw2","image/x-fujifilm-raf","video/x-m4v","video/3gpp2","application/x-esri-shape","audio/aac","audio/x-it","audio/x-s3m","audio/x-xm","video/MP1S","video/MP2P","application/vnd.sketchup.skp","image/avif","application/x-lzh-compressed","application/pgp-encrypted","application/x-asar","model/stl","application/vnd.ms-htmlhelp","model/3mf","image/jxl","application/zstd"]}},7044:(t,e)=>{"use strict";e.stringToBytes=t=>[...t].map((t=>t.charCodeAt(0))),e.tarHeaderChecksumMatches=(t,e=0)=>{const r=parseInt(t.toString("utf8",148,154).replace(/\0.*$/,"").trim(),8);if(isNaN(r))return!1;let i=256;for(let r=e;r<e+148;r++)i+=t[r];for(let r=e+156;r<e+512;r++)i+=t[r];return r===i},e.uint32SyncSafeToken={get:(t,e)=>127&t[e+3]|t[e+2]<<7|t[e+1]<<14|t[e]<<21,len:4}},3243:(t,e,r)=>{"use strict";var i=r(9680),n=Object.prototype.toString,a=Object.prototype.hasOwnProperty,o=function(t,e,r){for(var i=0,n=t.length;i<n;i++)a.call(t,i)&&(null==r?e(t[i],i,t):e.call(r,t[i],i,t))},s=function(t,e,r){for(var i=0,n=t.length;i<n;i++)null==r?e(t.charAt(i),i,t):e.call(r,t.charAt(i),i,t)},h=function(t,e,r){for(var i in t)a.call(t,i)&&(null==r?e(t[i],i,t):e.call(r,t[i],i,t))};t.exports=function(t,e,r){if(!i(e))throw new TypeError("iterator must be a function");var a;arguments.length>=3&&(a=r),"[object Array]"===n.call(t)?o(t,e,a):"string"==typeof t?s(t,e,a):h(t,e,a)}},2855:(t,e)=>{"use strict";function r(t,e,r,i){for(var n=t[e++],a=1<<n,o=a+1,s=o+1,h=n+1,l=(1<<h)-1,f=0,u=0,c=0,d=t[e++],p=new Int32Array(4096),m=null;;){for(;f<16&&0!==d;)u|=t[e++]<<f,f+=8,1===d?d=t[e++]:--d;if(f<h)break;var g=u&l;if(u>>=h,f-=h,g!==a){if(g===o)break;for(var b=g<s?g:m,_=0,y=b;y>a;)y=p[y]>>8,++_;var w=y;if(c+_+(b!==g?1:0)>i)return void console.log("Warning, gif stream longer than expected.");r[c++]=w;var v=c+=_;for(b!==g&&(r[c++]=w),y=b;_--;)y=p[y],r[--v]=255&y,y>>=8;null!==m&&s<4096&&(p[s++]=m<<8|w,s>=l+1&&h<12&&(++h,l=l<<1|1)),m=g}else s=o+1,l=(1<<(h=n+1))-1,m=null}return c!==i&&console.log("Warning, gif stream shorter than expected."),r}try{e.GifWriter=function(t,e,r,i){var n=0,a=void 0===(i=void 0===i?{}:i).loop?null:i.loop,o=void 0===i.palette?null:i.palette;if(e<=0||r<=0||e>65535||r>65535)throw new Error("Width/Height invalid.");function s(t){var e=t.length;if(e<2||e>256||e&e-1)throw new Error("Invalid code/color length, must be power of 2 and 2 .. 256.");return e}t[n++]=71,t[n++]=73,t[n++]=70,t[n++]=56,t[n++]=57,t[n++]=97;var h=0,l=0;if(null!==o){for(var f=s(o);f>>=1;)++h;if(f=1<<h,--h,void 0!==i.background){if((l=i.background)>=f)throw new Error("Background index out of range.");if(0===l)throw new Error("Background index explicitly passed as 0.")}}if(t[n++]=255&e,t[n++]=e>>8&255,t[n++]=255&r,t[n++]=r>>8&255,t[n++]=(null!==o?128:0)|h,t[n++]=l,t[n++]=0,null!==o)for(var u=0,c=o.length;u<c;++u){var d=o[u];t[n++]=d>>16&255,t[n++]=d>>8&255,t[n++]=255&d}if(null!==a){if(a<0||a>65535)throw new Error("Loop count invalid.");t[n++]=33,t[n++]=255,t[n++]=11,t[n++]=78,t[n++]=69,t[n++]=84,t[n++]=83,t[n++]=67,t[n++]=65,t[n++]=80,t[n++]=69,t[n++]=50,t[n++]=46,t[n++]=48,t[n++]=3,t[n++]=1,t[n++]=255&a,t[n++]=a>>8&255,t[n++]=0}var p=!1;this.addFrame=function(e,r,i,a,h,l){if(!0===p&&(--n,p=!1),l=void 0===l?{}:l,e<0||r<0||e>65535||r>65535)throw new Error("x/y invalid.");if(i<=0||a<=0||i>65535||a>65535)throw new Error("Width/Height invalid.");if(h.length<i*a)throw new Error("Not enough pixels for the frame size.");var f=!0,u=l.palette;if(null==u&&(f=!1,u=o),null==u)throw new Error("Must supply either a local or global palette.");for(var c=s(u),d=0;c>>=1;)++d;c=1<<d;var m=void 0===l.delay?0:l.delay,g=void 0===l.disposal?0:l.disposal;if(g<0||g>3)throw new Error("Disposal out of range.");var b=!1,_=0;if(void 0!==l.transparent&&null!==l.transparent&&(b=!0,(_=l.transparent)<0||_>=c))throw new Error("Transparent color index.");if((0!==g||b||0!==m)&&(t[n++]=33,t[n++]=249,t[n++]=4,t[n++]=g<<2|(!0===b?1:0),t[n++]=255&m,t[n++]=m>>8&255,t[n++]=_,t[n++]=0),t[n++]=44,t[n++]=255&e,t[n++]=e>>8&255,t[n++]=255&r,t[n++]=r>>8&255,t[n++]=255&i,t[n++]=i>>8&255,t[n++]=255&a,t[n++]=a>>8&255,t[n++]=!0===f?128|d-1:0,!0===f)for(var y=0,w=u.length;y<w;++y){var v=u[y];t[n++]=v>>16&255,t[n++]=v>>8&255,t[n++]=255&v}return n=function(t,e,r,i){t[e++]=r;var n=e++,a=1<<r,o=a-1,s=a+1,h=s+1,l=r+1,f=0,u=0;function c(r){for(;f>=r;)t[e++]=255&u,u>>=8,f-=8,e===n+256&&(t[n]=255,n=e++)}function d(t){u|=t<<f,f+=l,c(8)}var p=i[0]&o,m={};d(a);for(var g=1,b=i.length;g<b;++g){var _=i[g]&o,y=p<<8|_,w=m[y];if(void 0===w){for(u|=p<<f,f+=l;f>=8;)t[e++]=255&u,u>>=8,f-=8,e===n+256&&(t[n]=255,n=e++);4096===h?(d(a),h=s+1,l=r+1,m={}):(h>=1<<l&&++l,m[y]=h++),p=_}else p=w}return d(p),d(s),c(1),n+1===e?t[n]=0:(t[n]=e-n-1,t[e++]=0),e}(t,n,d<2?2:d,h),n},this.end=function(){return!1===p&&(t[n++]=59,p=!0),n},this.getOutputBuffer=function(){return t},this.setOutputBuffer=function(e){t=e},this.getOutputBufferPosition=function(){return n},this.setOutputBufferPosition=function(t){n=t}},e.GifReader=function(t){var e=0;if(71!==t[e++]||73!==t[e++]||70!==t[e++]||56!==t[e++]||56!=(t[e++]+1&253)||97!==t[e++])throw new Error("Invalid GIF 87a/89a header.");var i=t[e++]|t[e++]<<8,n=t[e++]|t[e++]<<8,a=t[e++],o=a>>7,s=1<<1+(7&a);t[e++],t[e++];var h=null,l=null;o&&(h=e,l=s,e+=3*s);var f=!0,u=[],c=0,d=null,p=0,m=null;for(this.width=i,this.height=n;f&&e<t.length;)switch(t[e++]){case 33:switch(t[e++]){case 255:if(11!==t[e]||78==t[e+1]&&69==t[e+2]&&84==t[e+3]&&83==t[e+4]&&67==t[e+5]&&65==t[e+6]&&80==t[e+7]&&69==t[e+8]&&50==t[e+9]&&46==t[e+10]&&48==t[e+11]&&3==t[e+12]&&1==t[e+13]&&0==t[e+16])e+=14,m=t[e++]|t[e++]<<8,e++;else for(e+=12;;){if(!((I=t[e++])>=0))throw Error("Invalid block size");if(0===I)break;e+=I}break;case 249:if(4!==t[e++]||0!==t[e+4])throw new Error("Invalid graphics extension block.");var g=t[e++];c=t[e++]|t[e++]<<8,d=t[e++],0==(1&g)&&(d=null),p=g>>2&7,e++;break;case 254:for(;;){if(!((I=t[e++])>=0))throw Error("Invalid block size");if(0===I)break;e+=I}break;default:throw new Error("Unknown graphic control label: 0x"+t[e-1].toString(16))}break;case 44:var b=t[e++]|t[e++]<<8,_=t[e++]|t[e++]<<8,y=t[e++]|t[e++]<<8,w=t[e++]|t[e++]<<8,v=t[e++],x=v>>6&1,E=1<<1+(7&v),k=h,S=l,M=!1;v>>7&&(M=!0,k=e,S=E,e+=3*E);var A=e;for(e++;;){var I;if(!((I=t[e++])>=0))throw Error("Invalid block size");if(0===I)break;e+=I}u.push({x:b,y:_,width:y,height:w,has_local_palette:M,palette_offset:k,palette_size:S,data_offset:A,data_length:e-A,transparent_index:d,interlaced:!!x,delay:c,disposal:p});break;case 59:f=!1;break;default:throw new Error("Unknown gif block: 0x"+t[e-1].toString(16))}this.numFrames=function(){return u.length},this.loopCount=function(){return m},this.frameInfo=function(t){if(t<0||t>=u.length)throw new Error("Frame index out of range.");return u[t]},this.decodeAndBlitFrameBGRA=function(e,n){var a=this.frameInfo(e),o=a.width*a.height,s=new Uint8Array(o);r(t,a.data_offset,s,o);var h=a.palette_offset,l=a.transparent_index;null===l&&(l=256);var f=a.width,u=i-f,c=f,d=4*(a.y*i+a.x),p=4*((a.y+a.height)*i+a.x),m=d,g=4*u;!0===a.interlaced&&(g+=4*i*7);for(var b=8,_=0,y=s.length;_<y;++_){var w=s[_];if(0===c&&(c=f,(m+=g)>=p&&(g=4*u+4*i*(b-1),m=d+(f+u)*(b<<1),b>>=1)),w===l)m+=4;else{var v=t[h+3*w],x=t[h+3*w+1],E=t[h+3*w+2];n[m++]=E,n[m++]=x,n[m++]=v,n[m++]=255}--c}},this.decodeAndBlitFrameRGBA=function(e,n){var a=this.frameInfo(e),o=a.width*a.height,s=new Uint8Array(o);r(t,a.data_offset,s,o);var h=a.palette_offset,l=a.transparent_index;null===l&&(l=256);var f=a.width,u=i-f,c=f,d=4*(a.y*i+a.x),p=4*((a.y+a.height)*i+a.x),m=d,g=4*u;!0===a.interlaced&&(g+=4*i*7);for(var b=8,_=0,y=s.length;_<y;++_){var w=s[_];if(0===c&&(c=f,(m+=g)>=p&&(g=4*u+4*i*(b-1),m=d+(f+u)*(b<<1),b>>=1)),w===l)m+=4;else{var v=t[h+3*w],x=t[h+3*w+1],E=t[h+3*w+2];n[m++]=v,n[m++]=x,n[m++]=E,n[m++]=255}--c}}}}catch(t){}},7604:(t,e,r)=>{"use strict";var i=r(8834).lW;class n{constructor(...t){if(0===t.length)throw new Error("constructor requires parameters");const e=t[0];if(null!==e&&"object"==typeof e)if(e instanceof n){const t=e.bitmap;this.bitmap={width:t.width,height:t.height,data:new i(t.width*t.height*4)},t.data.copy(this.bitmap.data)}else{if(!(e.width&&e.height&&e.data))throw new Error("unrecognized constructor parameters");this.bitmap=e}else{if("number"!=typeof e||"number"!=typeof t[1])throw new Error("unrecognized constructor parameters");{const r=e,n=t[1],a=t[2];this.bitmap={width:r,height:n},i.isBuffer(a)?this.bitmap.data=a:(this.bitmap.data=new i(r*n*4),"number"==typeof a&&this.fillRGBA(a))}}}blit(t,e,r,i,n,a,o){if(i+a>this.bitmap.width)throw new Error("copy exceeds width of source bitmap");if(e+a>t.bitmap.width)throw new Error("copy exceeds width of target bitmap");if(n+o>this.bitmap.height)throw new Error("copy exceeds height of source bitmap");if(r+o>t.bitmap.height)throw new Erro("copy exceeds height of target bitmap");const s=this.bitmap.data,h=t.bitmap.data,l=4*this.bitmap.width,f=4*t.bitmap.width,u=4*a;let c=n*l+4*i,d=r*f+4*e;for(;--o>=0;)s.copy(h,d,c,c+u),c+=l,d+=f;return this}fillRGBA(t){const e=this.bitmap.data,r=4*this.bitmap.height;let i=0;for(;i<r;)e.writeUInt32BE(t,i),i+=4;for(;i<e.length;)e.copy(e,i,0,r),i+=r;return this}getRGBA(t,e){const r=4*(e*this.bitmap.width+t);return this.bitmap.data.readUInt32BE(r)}getRGBASet(){const t=new Set,e=this.bitmap.data;for(let r=0;r<e.length;r+=4)t.add(e.readUInt32BE(r,!0));return t}greyscale(){const t=this.bitmap.data;return this.scan(0,0,this.bitmap.width,this.bitmap.height,((e,r,i)=>{const n=Math.round(.299*t[i]+.587*t[i+1]+.114*t[i+2]);t[i]=n,t[i+1]=n,t[i+2]=n})),this}reframe(t,e,r,i,a){const o=t<0?0:t,s=e<0?0:e,h=r+o>this.bitmap.width?this.bitmap.width-o:r,l=i+s>this.bitmap.height?this.bitmap.height-s:i,f=t<0?-t:0,u=e<0?-e:0;let c;if(void 0===a){if(o!==t||s!=e||h!==r||l!==i)throw new GifError("fillRGBA required for this reframing");c=new n(r,i)}else c=new n(r,i,a);return this.blit(c,f,u,o,s,h,l),this.bitmap=c.bitmap,this}scale(t){if(1===t)return;if(!Number.isInteger(t)||t<1)throw new Error("the scale must be an integer >= 1");const e=this.bitmap.width,r=this.bitmap.height,n=e*t*4,a=this.bitmap.data,o=new i(r*n*t);let s,h=0,l=0;for(let i=0;i<r;++i){s=l;for(let r=0;r<e;++r){const e=a.readUInt32BE(h,!0);for(let r=0;r<t;++r)o.writeUInt32BE(e,l),l+=4;h+=4}for(let e=1;e<t;++e)o.copy(o,l,s,l),l+=n,s+=n}return this.bitmap={width:e*t,height:r*t,data:o},this}scanAllCoords(t){const e=this.bitmap.width,r=this.bitmap.data.length;let i=0,n=0;for(let a=0;a<r;a+=4)t(i,n,a),++i===e&&(i=0,++n)}scanAllIndexes(t){const e=this.bitmap.data.length;for(let r=0;r<e;r+=4)t(r)}}t.exports=n},4364:(t,e)=>{"use strict";class r{constructor(t,e,r){this.width=r.width,this.height=r.height,this.loops=r.loops,this.usesTransparency=r.usesTransparency,this.colorScope=r.colorScope,this.frames=e,this.buffer=t}}r.GlobalColorsPreferred=0,r.GlobalColorsOnly=1,r.LocalColorsOnly=2;class i extends Error{constructor(t){super(t),t instanceof Error&&(this.stack="Gif"+t.stack)}}e.Gif=r,e.GifError=i},6512:(t,e,r)=>{"use strict";var i=r(8834).lW;const n=r(2855),{Gif:a,GifError:o}=r(4364);function s(){const t=r(4602);return s=function(){return t},t}const{GifFrame:h}=r(5585),l=100;function f(t,e){const r=t.indexOf(e);return-1===r?null:r}function u(t,e){for(var r,i=0,n=t.length-1;i<=n;)if(t[r=Math.floor((i+n)/2)]>e)n=r-1;else{if(!(t[r]<e))return r;i=r+1}return null}function c(t){const e=t.colors;t.usesTransparency&&e.push(0);const r=e.length;let i=2;for(;r>i;)i<<=1;e.length=i,e.fill(0,r)}function d(t,e){let r=t.bitmap.width*t.bitmap.height;return r=Math.ceil(r*e/8),r+=Math.ceil(r/255),l+r+768}function p(t){let e=t.indexCount,r=0;for(--e;e;)++r,e>>=1;return r>0?r:1}function m(t,e,r,n,a){if(r.interlaced)throw new o("writing interlaced GIFs is not supported");const s=function(t,e,r){const n=r.colors,a=n.length<=8?f:u,s=e.bitmap.data,h=new i(s.length/4);let l=n.length,c=0,d=0;for(;c<s.length;){if(0!==s[c+3]){const t=s.readUInt32BE(c,!0)>>8&16777215;h[d]=a(n,t)}else h[d]=l;c+=4,++d}if(r.usesTransparency){if(256===l)throw new o(`Frame ${t} already has 256 colorsand so can't use transparency`)}else l=null;return{buffer:h,transparentIndex:l}}(e,r,n),h={delay:r.delayCentisecs,disposal:r.disposalMethod,transparent:s.transparentIndex};a&&(c(n),h.palette=n.colors);try{let e,n=t.getOutputBuffer(),a=t.getOutputBufferPosition(),o=!0;for(;o;)if(e=t.addFrame(r.xOffset,r.yOffset,r.bitmap.width,r.bitmap.height,s.buffer,h),o=!1,e>=n.length-1){const e=new i(1.5*n.length);n.copy(e),t.setOutputBuffer(e),t.setOutputBufferPosition(a),n=e,o=!0}return n}catch(t){throw new o(t)}}e.GifCodec=class{constructor(t={}){this._transparentRGB=null,"number"==typeof t.transparentRGB&&0!==t.transparentRGB&&(this._transparentRGBA=256*t.transparentRGB),this._testInitialBufferSize=0}decodeGif(t){try{let e;try{e=new n.GifReader(t)}catch(t){throw new o(t)}const r=e.numFrames(),i=[],s={width:e.width,height:e.height,loops:e.loopCount(),usesTransparency:!1};for(let t=0;t<r;++t){const r=this._decodeFrame(e,t,s.usesTransparency);i.push(r.frame),r.usesTransparency&&(s.usesTransparency=!0)}return Promise.resolve(new a(t,i,s))}catch(t){return Promise.reject(t)}}encodeGif(t,e={}){try{if(null===t||0===t.length)throw new o("there are no frames");const r=s().getMaxDimensions(t);return(e=Object.assign({},e)).width=r.maxWidth,e.height=r.maxHeight,void 0===e.loops&&(e.loops=0),e.colorScope=e.colorScope||a.GlobalColorsPreferred,Promise.resolve(this._encodeGif(t,e))}catch(t){return Promise.reject(t)}}_decodeFrame(t,e,r){let n,a;try{if(n=t.frameInfo(e),a=new i(t.width*t.height*4),t.decodeAndBlitFrameRGBA(e,a),n.width!==t.width||n.height!==t.height){if(n.y&&(a=a.slice(n.y*t.width*4)),t.width>n.width)for(let e=0;e<n.height;++e)a.copy(a,e*n.width*4,4*(n.x+e*t.width),4*(n.x+e*t.width)+4*n.width);a=a.slice(0,n.width*n.height*4)}}catch(t){throw new o(t)}let s=!1;if(null===this._transparentRGBA){if(!r)for(let t=3;t<a.length;t+=4)0===a[t]&&(s=!0,t=a.length)}else for(let t=3;t<a.length;t+=4)0===a[t]&&(a.writeUInt32BE(this._transparentRGBA,t-3),s=!0);return{frame:new h(n.width,n.height,a,{xOffset:n.x,yOffset:n.y,disposalMethod:n.disposal,interlaced:n.interlaced,delayCentisecs:n.delay}),usesTransparency:s}}_encodeGif(t,e){let r;if(e.colorScope===a.LocalColorsOnly)r=s().getColorInfo(t,0);else if(r=s().getColorInfo(t,256),!r.colors){if(e.colorScope===a.GlobalColorsOnly)throw new o("Too many color indexes for global color table");e.colorScope=a.LocalColorsOnly}e.usesTransparency=r.usesTransparency;const h=r.palettes;return e.colorScope===a.LocalColorsOnly?function(t,e,r,s){const h={loop:e.loops};let l,f=new i(2e3);try{l=new n.GifWriter(f,e.width,e.height,h)}catch(t){throw new o(t)}for(let e=0;e<t.length;++e)f=m(l,e,t[e],s[e],!0);return new a(f.slice(0,l.end()),t,e)}(t,e,0,h):function(t,e,r,s){const h={colors:s.colors.slice(),usesTransparency:s.usesTransparency};c(h);const l={palette:h.colors,loop:e.loops};let f,u=new i(2e3);try{f=new n.GifWriter(u,e.width,e.height,l)}catch(t){throw new o(t)}for(let e=0;e<t.length;++e)u=m(f,e,t[e],s,!1);return new a(u.slice(0,f.end()),t,e)}(t,e,0,r)}_getSizeEstimateGlobal(t,e){if(this._testInitialBufferSize>0)return this._testInitialBufferSize;let r=968;const i=p(t);return e.forEach((t=>{r+=d(t,i)})),r}_getSizeEstimateLocal(t,e){if(this._testInitialBufferSize>0)return this._testInitialBufferSize;let r=200;for(let i=0;i<e.length;++i){const n=p(t[i]);r+=d(e[i],n)}return r}}},5585:(t,e,r)=>{"use strict";const i=r(7604),{GifError:n}=r(4364);class a extends i{constructor(...t){if(super(...t),t[0]instanceof a){const e=t[0];this.xOffset=e.xOffset,this.yOffset=e.yOffset,this.disposalMethod=e.disposalMethod,this.delayCentisecs=e.delayCentisecs,this.interlaced=e.interlaced}else{const e=t[t.length-1];let r={};"object"!=typeof e||e instanceof i||(r=e),this.xOffset=r.xOffset||0,this.yOffset=r.yOffset||0,this.disposalMethod=void 0!==r.disposalMethod?r.disposalMethod:a.DisposeToBackgroundColor,this.delayCentisecs=r.delayCentisecs||8,this.interlaced=r.interlaced||!1}}getPalette(){const t=new Set,e=this.bitmap.data;let r=0,i=!1;for(;r<e.length;){if(0===e[r+3])i=!0;else{const i=e.readUInt32BE(r,!0)>>8&16777215;t.add(i)}r+=4}const n=new Array(t.size),a=t.values();for(r=0;r<n.length;++r)n[r]=a.next().value;n.sort(((t,e)=>t-e));let o=n.length;return i&&++o,{colors:n,usesTransparency:i,indexCount:o}}}a.DisposeToAnything=0,a.DisposeNothing=1,a.DisposeToBackgroundColor=2,a.DisposeToPrevious=3,e.GifFrame=a},4602:(t,e,r)=>{"use strict";var i=r(8834).lW;const n=r(8522),a=r(2460),o=r(7604),{GifFrame:s}=r(5585),{GifError:h}=r(4364),{GifCodec:l}=r(6512),f=[".jpg",".jpeg",".png",".bmp"],u=new l;function c(t,e,r,i,n){const o=Array.isArray(t)?t:[t];if(n){if(["FloydSteinberg","FalseFloydSteinberg","Stucki","Atkinson","Jarvis","Burkes","Sierra","TwoSierra","SierraLite"].indexOf(n.ditherAlgorithm)<0)throw new Error(`Invalid ditherAlgorithm '${n.ditherAlgorithm}'`);void 0===n.serpentine&&(n.serpentine=!0),void 0===n.minimumColorDistanceToDither&&(n.minimumColorDistanceToDither=0),void 0===n.calculateErrorLikeGIMP&&(n.calculateErrorLikeGIMP=!1)}const s=new a.distance.Euclidean,h=new a.palette[e](s,r,i);let l;l=n?new a.image.ErrorDiffusionArray(s,a.image.ErrorDiffusionArrayKernel[n.ditherAlgorithm],n.serpentine,n.minimumColorDistanceToDither,n.calculateErrorLikeGIMP):new a.image.NearestColor(s);const f=[];o.forEach((t=>{const e=t.bitmap.data,r=new ArrayBuffer(e.length),i=new Uint32Array(r);for(let t=0,r=0;t<e.length;t+=4,++r)i[r]=e.readUInt32LE(t,!0);const n=a.utils.PointContainer.fromUint32Array(i,t.bitmap.width,t.bitmap.height);h.sample(n),f.push(n)}));const u=h.quantizeSync();for(let t=0;t<o.length;++t){const e=o[t].bitmap.data,r=l.quantizeSync(f[t],u).toUint32Array();for(let t=0,i=0;t<e.length;t+=4,++i)e.writeUInt32LE(r[i],t)}}e.cloneFrames=function(t){let e=[];return t.forEach((t=>{e.push(new s(t))})),e},e.getColorInfo=function(t,e){let r=!1;const i=[];for(let e=0;e<t.length;++e){let n=t[e].getPalette();if(n.usesTransparency&&(r=!0),n.indexCount>256)throw new h(`Frame ${e} uses more than 256 color indexes`);i.push(n)}if(0===e)return{usesTransparency:r,palettes:i};const n=new Set;i.forEach((t=>{t.colors.forEach((t=>{n.add(t)}))}));let a=n.size;if(r&&++a,e&&a>e)return{usesTransparency:r,palettes:i};const o=new Array(n.size),s=n.values();for(let t=0;t<o.length;++t)o[t]=s.next().value;return o.sort(((t,e)=>t-e)),{colors:o,indexCount:a,usesTransparency:r,palettes:i}},e.copyAsJimp=function(t,r){return e.shareAsJimp(t,new o(r))},e.getMaxDimensions=function(t){let e=0,r=0;return t.forEach((t=>{const i=t.xOffset+t.bitmap.width;i>e&&(e=i);const n=t.yOffset+t.bitmap.height;n>r&&(r=n)})),{maxWidth:e,maxHeight:r}},e.quantizeDekker=function(t,e,r){c(t,"NeuQuantFloat",e=e||256,0,r)},e.quantizeSorokin=function(t,e,r,i){let n;switch(e=e||256,r=r||"min-pop"){case"min-pop":n=2;break;case"top-pop":n=1;break;default:throw new Error(`Invalid quantizeSorokin histogram '${r}'`)}c(t,"RGBQuant",e,n,i)},e.quantizeWu=function(t,e,r,i){if(e=e||256,(r=r||5)<1||r>8)throw new Error("Invalid quantization quality");c(t,"WuQuant",e,r,i)},e.read=function(t,e){return e=e||u,i.isBuffer(t)?e.decodeGif(t):(r=t,new Promise(((t,e)=>{n.readFile(r,((r,i)=>r?e(r):t(i)))}))).then((t=>e.decodeGif(t)));var r},e.shareAsJimp=function(t,e){const r=new t(e.bitmap.width,e.bitmap.height,0);return r.bitmap.data=e.bitmap.data,r},e.write=function(t,e,r,i){i=i||u;const a=t.match(/\.[a-zA-Z]+$/);if(null!==a&&f.includes(a[0].toLowerCase()))throw new Error(`GIF '${t}' has an unexpected suffix`);return i.encodeGif(e,r).then((e=>function(t,e){return new Promise(((r,i)=>{n.writeFile(t,e,(t=>t?i(t):r()))}))}(t,e.buffer).then((()=>e))))}},9455:(t,e,r)=>{"use strict";const i=r(7604),{Gif:n,GifError:a}=r(4364),{GifCodec:o}=r(6512),{GifFrame:s}=r(5585),h=r(4602);t.exports={BitmapImage:i,Gif:n,GifCodec:o,GifFrame:s,GifUtil:h,GifError:a}},5048:(t,e,r)=>{var i;i="undefined"!=typeof window?window:void 0!==r.g?r.g:"undefined"!=typeof self?self:{},t.exports=i},2333:(t,e)=>{e.read=function(t,e,r,i,n){var a,o,s=8*n-i-1,h=(1<<s)-1,l=h>>1,f=-7,u=r?n-1:0,c=r?-1:1,d=t[e+u];for(u+=c,a=d&(1<<-f)-1,d>>=-f,f+=s;f>0;a=256*a+t[e+u],u+=c,f-=8);for(o=a&(1<<-f)-1,a>>=-f,f+=i;f>0;o=256*o+t[e+u],u+=c,f-=8);if(0===a)a=1-l;else{if(a===h)return o?NaN:1/0*(d?-1:1);o+=Math.pow(2,i),a-=l}return(d?-1:1)*o*Math.pow(2,a-i)},e.write=function(t,e,r,i,n,a){var o,s,h,l=8*a-n-1,f=(1<<l)-1,u=f>>1,c=23===n?Math.pow(2,-24)-Math.pow(2,-77):0,d=i?0:a-1,p=i?1:-1,m=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(s=isNaN(e)?1:0,o=f):(o=Math.floor(Math.log(e)/Math.LN2),e*(h=Math.pow(2,-o))<1&&(o--,h*=2),(e+=o+u>=1?c/h:c*Math.pow(2,1-u))*h>=2&&(o++,h/=2),o+u>=f?(s=0,o=f):o+u>=1?(s=(e*h-1)*Math.pow(2,n),o+=u):(s=e*Math.pow(2,u-1)*Math.pow(2,n),o=0));n>=8;t[r+d]=255&s,d+=p,s/=256,n-=8);for(o=o<<n|s,l+=n;l>0;t[r+d]=255&o,d+=p,o/=256,l-=8);t[r+d-p]|=128*m}},9680:t=>{"use strict";var e=Function.prototype.toString,r=/^\s*class\b/,i=function(t){try{var i=e.call(t);return r.test(i)}catch(t){return!1}},n=Object.prototype.toString,a="function"==typeof Symbol&&"symbol"==typeof Symbol.toStringTag;t.exports=function(t){if(!t)return!1;if("function"!=typeof t&&"object"!=typeof t)return!1;if("function"==typeof t&&!t.prototype)return!0;if(a)return function(t){try{return!i(t)&&(e.call(t),!0)}catch(t){return!1}}(t);if(i(t))return!1;var r=n.call(t);return"[object Function]"===r||"[object GeneratorFunction]"===r}},9748:t=>{t.exports=function(t){var r=e.call(t);return"[object Function]"===r||"function"==typeof t&&"[object RegExp]"!==r||"undefined"!=typeof window&&(t===window.setTimeout||t===window.alert||t===window.confirm||t===window.prompt)};var e=Object.prototype.toString},9307:(t,e,r)=>{r(6168),t.exports=self.fetch.bind(self)},2691:(t,e,r)=>{var i=r(706),n=r(770);t.exports={encode:i,decode:n}},770:(t,e,r)=>{var i=r(8834).lW,n=function(){"use strict";var t=new Int32Array([0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]),e=4017,r=799,i=3406,n=2276,a=1567,o=3784,s=5793,h=2896;function l(){}function f(t,e){for(var r,i,n=0,a=[],o=16;o>0&&!t[o-1];)o--;a.push({children:[],index:0});var s,h=a[0];for(r=0;r<o;r++){for(i=0;i<t[r];i++){for((h=a.pop()).children[h.index]=e[n];h.index>0;){if(0===a.length)throw new Error("Could not recreate Huffman Table");h=a.pop()}for(h.index++,a.push(h);a.length<=r;)a.push(s={children:[],index:0}),h.children[h.index]=s.children,h=s;n++}r+1<o&&(a.push(s={children:[],index:0}),h.children[h.index]=s.children,h=s)}return a[0].children}function u(e,r,i,n,a,o,s,h,l,f){i.precision,i.samplesPerLine,i.scanLines;var u=i.mcusPerLine,c=i.progressive,d=(i.maxH,i.maxV,r),p=0,m=0;function g(){if(m>0)return m--,p>>m&1;if(255==(p=e[r++])){var t=e[r++];if(t)throw new Error("unexpected marker: "+(p<<8|t).toString(16))}return m=7,p>>>7}function b(t){for(var e,r=t;null!==(e=g());){if("number"==typeof(r=r[e]))return r;if("object"!=typeof r)throw new Error("invalid huffman sequence")}return null}function _(t){for(var e=0;t>0;){var r=g();if(null===r)return;e=e<<1|r,t--}return e}function y(t){var e=_(t);return e>=1<<t-1?e:e+(-1<<t)+1}var w,v=0,x=0;function E(t,e,r,i,n){var a=r%u,o=(r/u|0)*t.v+i,s=a*t.h+n;void 0===t.blocks[o]&&f.tolerantDecoding||e(t,t.blocks[o][s])}function k(t,e,r){var i=r/t.blocksPerLine|0,n=r%t.blocksPerLine;void 0===t.blocks[i]&&f.tolerantDecoding||e(t,t.blocks[i][n])}var S,M,A,I,B,T,R=n.length;T=c?0===o?0===h?function(t,e){var r=b(t.huffmanTableDC),i=0===r?0:y(r)<<l;e[0]=t.pred+=i}:function(t,e){e[0]|=g()<<l}:0===h?function(e,r){if(v>0)v--;else for(var i=o,n=s;i<=n;){var a=b(e.huffmanTableAC),h=15&a,f=a>>4;if(0!==h)r[t[i+=f]]=y(h)*(1<<l),i++;else{if(f<15){v=_(f)+(1<<f)-1;break}i+=16}}}:function(e,r){for(var i=o,n=s,a=0;i<=n;){var h=t[i],f=r[h]<0?-1:1;switch(x){case 0:var u=b(e.huffmanTableAC),c=15&u;if(a=u>>4,0===c)a<15?(v=_(a)+(1<<a),x=4):(a=16,x=1);else{if(1!==c)throw new Error("invalid ACn encoding");w=y(c),x=a?2:3}continue;case 1:case 2:r[h]?r[h]+=(g()<<l)*f:0==--a&&(x=2==x?3:0);break;case 3:r[h]?r[h]+=(g()<<l)*f:(r[h]=w<<l,x=0);break;case 4:r[h]&&(r[h]+=(g()<<l)*f)}i++}4===x&&0==--v&&(x=0)}:function(e,r){var i=b(e.huffmanTableDC),n=0===i?0:y(i);r[0]=e.pred+=n;for(var a=1;a<64;){var o=b(e.huffmanTableAC),s=15&o,h=o>>4;if(0!==s)r[t[a+=h]]=y(s),a++;else{if(h<15)break;a+=16}}};var P,O,L,C,U=0;for(O=1==R?n[0].blocksPerLine*n[0].blocksPerColumn:u*i.mcusPerColumn,a||(a=O);U<O;){for(M=0;M<R;M++)n[M].pred=0;if(v=0,1==R)for(S=n[0],B=0;B<a;B++)k(S,T,U),U++;else for(B=0;B<a;B++){for(M=0;M<R;M++)for(L=(S=n[M]).h,C=S.v,A=0;A<C;A++)for(I=0;I<L;I++)E(S,T,U,A,I);if(++U===O)break}if(U===O)do{if(255===e[r]&&0!==e[r+1])break;r+=1}while(r<e.length-2);if(m=0,(P=e[r]<<8|e[r+1])<65280)throw new Error("marker was not found");if(!(P>=65488&&P<=65495))break;r+=2}return r-d}function c(t,l){var f,u,c=[],d=l.blocksPerLine,p=l.blocksPerColumn,m=d<<3,b=new Int32Array(64),_=new Uint8Array(64);function y(t,f,u){var c,d,p,m,g,b,_,y,w,v,x=l.quantizationTable,E=u;for(v=0;v<64;v++)E[v]=t[v]*x[v];for(v=0;v<8;++v){var k=8*v;0!=E[1+k]||0!=E[2+k]||0!=E[3+k]||0!=E[4+k]||0!=E[5+k]||0!=E[6+k]||0!=E[7+k]?(c=s*E[0+k]+128>>8,d=s*E[4+k]+128>>8,p=E[2+k],m=E[6+k],g=h*(E[1+k]-E[7+k])+128>>8,y=h*(E[1+k]+E[7+k])+128>>8,b=E[3+k]<<4,_=E[5+k]<<4,w=c-d+1>>1,c=c+d+1>>1,d=w,w=p*o+m*a+128>>8,p=p*a-m*o+128>>8,m=w,w=g-_+1>>1,g=g+_+1>>1,_=w,w=y+b+1>>1,b=y-b+1>>1,y=w,w=c-m+1>>1,c=c+m+1>>1,m=w,w=d-p+1>>1,d=d+p+1>>1,p=w,w=g*n+y*i+2048>>12,g=g*i-y*n+2048>>12,y=w,w=b*r+_*e+2048>>12,b=b*e-_*r+2048>>12,_=w,E[0+k]=c+y,E[7+k]=c-y,E[1+k]=d+_,E[6+k]=d-_,E[2+k]=p+b,E[5+k]=p-b,E[3+k]=m+g,E[4+k]=m-g):(w=s*E[0+k]+512>>10,E[0+k]=w,E[1+k]=w,E[2+k]=w,E[3+k]=w,E[4+k]=w,E[5+k]=w,E[6+k]=w,E[7+k]=w)}for(v=0;v<8;++v){var S=v;0!=E[8+S]||0!=E[16+S]||0!=E[24+S]||0!=E[32+S]||0!=E[40+S]||0!=E[48+S]||0!=E[56+S]?(c=s*E[0+S]+2048>>12,d=s*E[32+S]+2048>>12,p=E[16+S],m=E[48+S],g=h*(E[8+S]-E[56+S])+2048>>12,y=h*(E[8+S]+E[56+S])+2048>>12,b=E[24+S],_=E[40+S],w=c-d+1>>1,c=c+d+1>>1,d=w,w=p*o+m*a+2048>>12,p=p*a-m*o+2048>>12,m=w,w=g-_+1>>1,g=g+_+1>>1,_=w,w=y+b+1>>1,b=y-b+1>>1,y=w,w=c-m+1>>1,c=c+m+1>>1,m=w,w=d-p+1>>1,d=d+p+1>>1,p=w,w=g*n+y*i+2048>>12,g=g*i-y*n+2048>>12,y=w,w=b*r+_*e+2048>>12,b=b*e-_*r+2048>>12,_=w,E[0+S]=c+y,E[56+S]=c-y,E[8+S]=d+_,E[48+S]=d-_,E[16+S]=p+b,E[40+S]=p-b,E[24+S]=m+g,E[32+S]=m-g):(w=s*u[v+0]+8192>>14,E[0+S]=w,E[8+S]=w,E[16+S]=w,E[24+S]=w,E[32+S]=w,E[40+S]=w,E[48+S]=w,E[56+S]=w)}for(v=0;v<64;++v){var M=128+(E[v]+8>>4);f[v]=M<0?0:M>255?255:M}}g(m*p*8);for(var w=0;w<p;w++){var v=w<<3;for(f=0;f<8;f++)c.push(new Uint8Array(m));for(var x=0;x<d;x++){y(l.blocks[w][x],_,b);var E=0,k=x<<3;for(u=0;u<8;u++){var S=c[v+u];for(f=0;f<8;f++)S[k+f]=_[E++]}}}return c}function d(t){return t<0?0:t>255?255:t}l.prototype={load:function(t){var e=new XMLHttpRequest;e.open("GET",t,!0),e.responseType="arraybuffer",e.onload=function(){var t=new Uint8Array(e.response||e.mozResponseArrayBuffer);this.parse(t),this.onload&&this.onload()}.bind(this),e.send(null)},parse:function(e){var r=1e3*this.opts.maxResolutionInMP*1e3,i=0;function n(){var t=e[i]<<8|e[i+1];return i+=2,t}function a(t){var e,r,i=1,n=1;for(r in t.components)t.components.hasOwnProperty(r)&&(i<(e=t.components[r]).h&&(i=e.h),n<e.v&&(n=e.v));var a=Math.ceil(t.samplesPerLine/8/i),o=Math.ceil(t.scanLines/8/n);for(r in t.components)if(t.components.hasOwnProperty(r)){e=t.components[r];var s=Math.ceil(Math.ceil(t.samplesPerLine/8)*e.h/i),h=Math.ceil(Math.ceil(t.scanLines/8)*e.v/n),l=a*e.h,f=o*e.v,u=[];g(f*l*256);for(var c=0;c<f;c++){for(var d=[],p=0;p<l;p++)d.push(new Int32Array(64));u.push(d)}e.blocksPerLine=s,e.blocksPerColumn=h,e.blocks=u}t.maxH=i,t.maxV=n,t.mcusPerLine=a,t.mcusPerColumn=o}e.length;var o,s,h,l,d=null,p=null,m=[],b=[],_=[],y=[],w=n(),v=-1;if(this.comments=[],65496!=w)throw new Error("SOI not found");for(w=n();65497!=w;){switch(w){case 65280:break;case 65504:case 65505:case 65506:case 65507:case 65508:case 65509:case 65510:case 65511:case 65512:case 65513:case 65514:case 65515:case 65516:case 65517:case 65518:case 65519:case 65534:var x=(h=void 0,l=void 0,h=n(),l=e.subarray(i,i+h-2),i+=l.length,l);if(65534===w){var E=String.fromCharCode.apply(null,x);this.comments.push(E)}65504===w&&74===x[0]&&70===x[1]&&73===x[2]&&70===x[3]&&0===x[4]&&(d={version:{major:x[5],minor:x[6]},densityUnits:x[7],xDensity:x[8]<<8|x[9],yDensity:x[10]<<8|x[11],thumbWidth:x[12],thumbHeight:x[13],thumbData:x.subarray(14,14+3*x[12]*x[13])}),65505===w&&69===x[0]&&120===x[1]&&105===x[2]&&102===x[3]&&0===x[4]&&(this.exifBuffer=x.subarray(5,x.length)),65518===w&&65===x[0]&&100===x[1]&&111===x[2]&&98===x[3]&&101===x[4]&&0===x[5]&&(p={version:x[6],flags0:x[7]<<8|x[8],flags1:x[9]<<8|x[10],transformCode:x[11]});break;case 65499:for(var k=n()+i-2;i<k;){var S=e[i++];g(256);var M=new Int32Array(64);if(S>>4==0)for(V=0;V<64;V++)M[t[V]]=e[i++];else{if(S>>4!=1)throw new Error("DQT: invalid table spec");for(V=0;V<64;V++)M[t[V]]=n()}m[15&S]=M}break;case 65472:case 65473:case 65474:n(),(o={}).extended=65473===w,o.progressive=65474===w,o.precision=e[i++],o.scanLines=n(),o.samplesPerLine=n(),o.components={},o.componentsOrder=[];var A=o.scanLines*o.samplesPerLine;if(A>r){var I=Math.ceil((A-r)/1e6);throw new Error(`maxResolutionInMP limit exceeded by ${I}MP`)}var B,T=e[i++];for(Z=0;Z<T;Z++){B=e[i];var R=e[i+1]>>4,P=15&e[i+1],O=e[i+2];if(R<=0||P<=0)throw new Error("Invalid sampling factor, expected values above 0");o.componentsOrder.push(B),o.components[B]={h:R,v:P,quantizationIdx:O},i+=3}a(o),b.push(o);break;case 65476:var L=n();for(Z=2;Z<L;){var C=e[i++],U=new Uint8Array(16),z=0;for(V=0;V<16;V++,i++)z+=U[V]=e[i];g(16+z);var D=new Uint8Array(z);for(V=0;V<z;V++,i++)D[V]=e[i];Z+=17+z,(C>>4==0?y:_)[15&C]=f(U,D)}break;case 65501:n(),s=n();break;case 65500:n(),n();break;case 65498:n();var N=e[i++],F=[];for(Z=0;Z<N;Z++){X=o.components[e[i++]];var j=e[i++];X.huffmanTableDC=y[j>>4],X.huffmanTableAC=_[15&j],F.push(X)}var G=e[i++],H=e[i++],W=e[i++],q=u(e,i,o,F,s,G,H,W>>4,15&W,this.opts);i+=q;break;case 65535:255!==e[i]&&i--;break;default:if(255==e[i-3]&&e[i-2]>=192&&e[i-2]<=254){i-=3;break}if(224===w||225==w){if(-1!==v)throw new Error(`first unknown JPEG marker at offset ${v.toString(16)}, second unknown JPEG marker ${w.toString(16)} at offset ${(i-1).toString(16)}`);v=i-1;const t=n();if(255===e[i+t-2]){i+=t-2;break}}throw new Error("unknown JPEG marker "+w.toString(16))}w=n()}if(1!=b.length)throw new Error("only single frame JPEGs supported");for(var Z=0;Z<b.length;Z++){var Y=b[Z].components;for(var V in Y)Y[V].quantizationTable=m[Y[V].quantizationIdx],delete Y[V].quantizationIdx}for(this.width=o.samplesPerLine,this.height=o.scanLines,this.jfif=d,this.adobe=p,this.components=[],Z=0;Z<o.componentsOrder.length;Z++){var X=o.components[o.componentsOrder[Z]];this.components.push({lines:c(0,X),scaleX:X.h/o.maxH,scaleY:X.v/o.maxV})}},getData:function(t,e){var r,i,n,a,o,s,h,l,f,u,c,p,m,b,_,y,w,v,x,E,k,S=this.width/t,M=this.height/e,A=0,I=t*e*this.components.length;g(I);var B=new Uint8Array(I);switch(this.components.length){case 1:for(r=this.components[0],u=0;u<e;u++)for(o=r.lines[0|u*r.scaleY*M],f=0;f<t;f++)c=o[0|f*r.scaleX*S],B[A++]=c;break;case 2:for(r=this.components[0],i=this.components[1],u=0;u<e;u++)for(o=r.lines[0|u*r.scaleY*M],s=i.lines[0|u*i.scaleY*M],f=0;f<t;f++)c=o[0|f*r.scaleX*S],B[A++]=c,c=s[0|f*i.scaleX*S],B[A++]=c;break;case 3:for(k=!0,this.adobe&&this.adobe.transformCode?k=!0:void 0!==this.opts.colorTransform&&(k=!!this.opts.colorTransform),r=this.components[0],i=this.components[1],n=this.components[2],u=0;u<e;u++)for(o=r.lines[0|u*r.scaleY*M],s=i.lines[0|u*i.scaleY*M],h=n.lines[0|u*n.scaleY*M],f=0;f<t;f++)k?(c=o[0|f*r.scaleX*S],p=s[0|f*i.scaleX*S],v=d(c+1.402*((m=h[0|f*n.scaleX*S])-128)),x=d(c-.3441363*(p-128)-.71413636*(m-128)),E=d(c+1.772*(p-128))):(v=o[0|f*r.scaleX*S],x=s[0|f*i.scaleX*S],E=h[0|f*n.scaleX*S]),B[A++]=v,B[A++]=x,B[A++]=E;break;case 4:if(!this.adobe)throw new Error("Unsupported color mode (4 components)");for(k=!1,this.adobe&&this.adobe.transformCode?k=!0:void 0!==this.opts.colorTransform&&(k=!!this.opts.colorTransform),r=this.components[0],i=this.components[1],n=this.components[2],a=this.components[3],u=0;u<e;u++)for(o=r.lines[0|u*r.scaleY*M],s=i.lines[0|u*i.scaleY*M],h=n.lines[0|u*n.scaleY*M],l=a.lines[0|u*a.scaleY*M],f=0;f<t;f++)k?(c=o[0|f*r.scaleX*S],p=s[0|f*i.scaleX*S],m=h[0|f*n.scaleX*S],b=l[0|f*a.scaleX*S],_=255-d(c+1.402*(m-128)),y=255-d(c-.3441363*(p-128)-.71413636*(m-128)),w=255-d(c+1.772*(p-128))):(_=o[0|f*r.scaleX*S],y=s[0|f*i.scaleX*S],w=h[0|f*n.scaleX*S],b=l[0|f*a.scaleX*S]),B[A++]=255-_,B[A++]=255-y,B[A++]=255-w,B[A++]=255-b;break;default:throw new Error("Unsupported color mode")}return B},copyToImageData:function(t,e){var r,i,n,a,o,s,h,l,f,u=t.width,c=t.height,p=t.data,m=this.getData(u,c),g=0,b=0;switch(this.components.length){case 1:for(i=0;i<c;i++)for(r=0;r<u;r++)n=m[g++],p[b++]=n,p[b++]=n,p[b++]=n,e&&(p[b++]=255);break;case 3:for(i=0;i<c;i++)for(r=0;r<u;r++)h=m[g++],l=m[g++],f=m[g++],p[b++]=h,p[b++]=l,p[b++]=f,e&&(p[b++]=255);break;case 4:for(i=0;i<c;i++)for(r=0;r<u;r++)o=m[g++],s=m[g++],n=m[g++],h=255-d(o*(1-(a=m[g++])/255)+a),l=255-d(s*(1-a/255)+a),f=255-d(n*(1-a/255)+a),p[b++]=h,p[b++]=l,p[b++]=f,e&&(p[b++]=255);break;default:throw new Error("Unsupported color mode")}}};var p=0,m=0;function g(t=0){var e=p+t;if(e>m){var r=Math.ceil((e-m)/1024/1024);throw new Error(`maxMemoryUsageInMB limit exceeded by at least ${r}MB`)}p=e}return l.resetMaxMemoryUsage=function(t){p=0,m=t},l.getBytesAllocated=function(){return p},l.requestMemoryAllocation=g,l}();t.exports=function(t,e={}){var r={colorTransform:void 0,useTArray:!1,formatAsRGBA:!0,tolerantDecoding:!0,maxResolutionInMP:100,maxMemoryUsageInMB:512,...e},a=new Uint8Array(t),o=new n;o.opts=r,n.resetMaxMemoryUsage(1024*r.maxMemoryUsageInMB*1024),o.parse(a);var s=r.formatAsRGBA?4:3,h=o.width*o.height*s;try{n.requestMemoryAllocation(h);var l={width:o.width,height:o.height,exifBuffer:o.exifBuffer,data:r.useTArray?new Uint8Array(h):i.alloc(h)};o.comments.length>0&&(l.comments=o.comments)}catch(t){if(t instanceof RangeError)throw new Error("Could not allocate enough memory for the image. Required: "+h);if(t instanceof ReferenceError&&"Buffer is not defined"===t.message)throw new Error("Buffer is not globally defined in this environment. Consider setting useTArray to true");throw t}return o.copyToImageData(l,r.formatAsRGBA),l}},706:(t,e,r)=>{var i=r(8834).lW;function n(t){Math.round;var e,r,n,a,o,s=Math.floor,h=new Array(64),l=new Array(64),f=new Array(64),u=new Array(64),c=new Array(65535),d=new Array(65535),p=new Array(64),m=new Array(64),g=[],b=0,_=7,y=new Array(64),w=new Array(64),v=new Array(64),x=new Array(256),E=new Array(2048),k=[0,1,5,6,14,15,27,28,2,4,7,13,16,26,29,42,3,8,12,17,25,30,41,43,9,11,18,24,31,40,44,53,10,19,23,32,39,45,52,54,20,22,33,38,46,51,55,60,21,34,37,47,50,56,59,61,35,36,48,49,57,58,62,63],S=[0,0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0],M=[0,1,2,3,4,5,6,7,8,9,10,11],A=[0,0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,125],I=[1,2,3,0,4,17,5,18,33,49,65,6,19,81,97,7,34,113,20,50,129,145,161,8,35,66,177,193,21,82,209,240,36,51,98,114,130,9,10,22,23,24,25,26,37,38,39,40,41,42,52,53,54,55,56,57,58,67,68,69,70,71,72,73,74,83,84,85,86,87,88,89,90,99,100,101,102,103,104,105,106,115,116,117,118,119,120,121,122,131,132,133,134,135,136,137,138,146,147,148,149,150,151,152,153,154,162,163,164,165,166,167,168,169,170,178,179,180,181,182,183,184,185,186,194,195,196,197,198,199,200,201,202,210,211,212,213,214,215,216,217,218,225,226,227,228,229,230,231,232,233,234,241,242,243,244,245,246,247,248,249,250],B=[0,0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0],T=[0,1,2,3,4,5,6,7,8,9,10,11],R=[0,0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,119],P=[0,1,2,3,17,4,5,33,49,6,18,65,81,7,97,113,19,34,50,129,8,20,66,145,161,177,193,9,35,51,82,240,21,98,114,209,10,22,36,52,225,37,241,23,24,25,26,38,39,40,41,42,53,54,55,56,57,58,67,68,69,70,71,72,73,74,83,84,85,86,87,88,89,90,99,100,101,102,103,104,105,106,115,116,117,118,119,120,121,122,130,131,132,133,134,135,136,137,138,146,147,148,149,150,151,152,153,154,162,163,164,165,166,167,168,169,170,178,179,180,181,182,183,184,185,186,194,195,196,197,198,199,200,201,202,210,211,212,213,214,215,216,217,218,226,227,228,229,230,231,232,233,234,242,243,244,245,246,247,248,249,250];function O(t,e){for(var r=0,i=0,n=new Array,a=1;a<=16;a++){for(var o=1;o<=t[a];o++)n[e[i]]=[],n[e[i]][0]=r,n[e[i]][1]=a,i++,r++;r*=2}return n}function L(t){for(var e=t[0],r=t[1]-1;r>=0;)e&1<<r&&(b|=1<<_),r--,--_<0&&(255==b?(C(255),C(0)):C(b),_=7,b=0)}function C(t){g.push(t)}function U(t){C(t>>8&255),C(255&t)}function z(t,e,r,i,n){for(var a,o=n[0],s=n[240],h=function(t,e){var r,i,n,a,o,s,h,l,f,u,c=0;for(f=0;f<8;++f){r=t[c],i=t[c+1],n=t[c+2],a=t[c+3],o=t[c+4],s=t[c+5],h=t[c+6];var d=r+(l=t[c+7]),m=r-l,g=i+h,b=i-h,_=n+s,y=n-s,w=a+o,v=a-o,x=d+w,E=d-w,k=g+_,S=g-_;t[c]=x+k,t[c+4]=x-k;var M=.707106781*(S+E);t[c+2]=E+M,t[c+6]=E-M;var A=.382683433*((x=v+y)-(S=b+m)),I=.5411961*x+A,B=1.306562965*S+A,T=.707106781*(k=y+b),R=m+T,P=m-T;t[c+5]=P+I,t[c+3]=P-I,t[c+1]=R+B,t[c+7]=R-B,c+=8}for(c=0,f=0;f<8;++f){r=t[c],i=t[c+8],n=t[c+16],a=t[c+24],o=t[c+32],s=t[c+40],h=t[c+48];var O=r+(l=t[c+56]),L=r-l,C=i+h,U=i-h,z=n+s,D=n-s,N=a+o,F=a-o,j=O+N,G=O-N,H=C+z,W=C-z;t[c]=j+H,t[c+32]=j-H;var q=.707106781*(W+G);t[c+16]=G+q,t[c+48]=G-q;var Z=.382683433*((j=F+D)-(W=U+L)),Y=.5411961*j+Z,V=1.306562965*W+Z,X=.707106781*(H=D+U),J=L+X,Q=L-X;t[c+40]=Q+Y,t[c+24]=Q-Y,t[c+8]=J+V,t[c+56]=J-V,c++}for(f=0;f<64;++f)u=t[f]*e[f],p[f]=u>0?u+.5|0:u-.5|0;return p}(t,e),l=0;l<64;++l)m[k[l]]=h[l];var f=m[0]-r;r=m[0],0==f?L(i[0]):(L(i[d[a=32767+f]]),L(c[a]));for(var u=63;u>0&&0==m[u];u--);if(0==u)return L(o),r;for(var g,b=1;b<=u;){for(var _=b;0==m[b]&&b<=u;++b);var y=b-_;if(y>=16){g=y>>4;for(var w=1;w<=g;++w)L(s);y&=15}a=32767+m[b],L(n[(y<<4)+d[a]]),L(c[a]),b++}return 63!=u&&L(o),r}function D(t){t<=0&&(t=1),t>100&&(t=100),o!=t&&(function(t){for(var e=[16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99],r=0;r<64;r++){var i=s((e[r]*t+50)/100);i<1?i=1:i>255&&(i=255),h[k[r]]=i}for(var n=[17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99],a=0;a<64;a++){var o=s((n[a]*t+50)/100);o<1?o=1:o>255&&(o=255),l[k[a]]=o}for(var c=[1,1.387039845,1.306562965,1.175875602,1,.785694958,.5411961,.275899379],d=0,p=0;p<8;p++)for(var m=0;m<8;m++)f[d]=1/(h[k[d]]*c[p]*c[m]*8),u[d]=1/(l[k[d]]*c[p]*c[m]*8),d++}(t<50?Math.floor(5e3/t):Math.floor(200-2*t)),o=t)}this.encode=function(t,o){var s;(new Date).getTime(),o&&D(o),g=new Array,b=0,_=7,U(65496),U(65504),U(16),C(74),C(70),C(73),C(70),C(0),C(1),C(1),C(0),U(1),U(1),C(0),C(0),void 0!==(s=t.comments)&&s.constructor===Array&&s.forEach((t=>{if("string"==typeof t){U(65534);var e,r=t.length;for(U(r+2),e=0;e<r;e++)C(t.charCodeAt(e))}})),function(t){if(t){U(65505),69===t[0]&&120===t[1]&&105===t[2]&&102===t[3]?U(t.length+2):(U(t.length+5+2),C(69),C(120),C(105),C(102),C(0));for(var e=0;e<t.length;e++)C(t[e])}}(t.exifBuffer),function(){U(65499),U(132),C(0);for(var t=0;t<64;t++)C(h[t]);C(1);for(var e=0;e<64;e++)C(l[e])}(),function(t,e){U(65472),U(17),C(8),U(e),U(t),C(3),C(1),C(17),C(0),C(2),C(17),C(1),C(3),C(17),C(1)}(t.width,t.height),function(){U(65476),U(418),C(0);for(var t=0;t<16;t++)C(S[t+1]);for(var e=0;e<=11;e++)C(M[e]);C(16);for(var r=0;r<16;r++)C(A[r+1]);for(var i=0;i<=161;i++)C(I[i]);C(1);for(var n=0;n<16;n++)C(B[n+1]);for(var a=0;a<=11;a++)C(T[a]);C(17);for(var o=0;o<16;o++)C(R[o+1]);for(var s=0;s<=161;s++)C(P[s])}(),U(65498),U(12),C(3),C(1),C(0),C(2),C(17),C(3),C(17),C(0),C(63),C(0);var c=0,d=0,p=0;b=0,_=7,this.encode.displayName="_encode_";for(var m,x,k,O,N,F,j,G,H,W=t.data,q=t.width,Z=t.height,Y=4*q,V=0;V<Z;){for(m=0;m<Y;){for(F=N=Y*V+m,j=-1,G=0,H=0;H<64;H++)F=N+(G=H>>3)*Y+(j=4*(7&H)),V+G>=Z&&(F-=Y*(V+1+G-Z)),m+j>=Y&&(F-=m+j-Y+4),x=W[F++],k=W[F++],O=W[F++],y[H]=(E[x]+E[k+256>>0]+E[O+512>>0]>>16)-128,w[H]=(E[x+768>>0]+E[k+1024>>0]+E[O+1280>>0]>>16)-128,v[H]=(E[x+1280>>0]+E[k+1536>>0]+E[O+1792>>0]>>16)-128;c=z(y,f,c,e,n),d=z(w,u,d,r,a),p=z(v,u,p,r,a),m+=32}V+=8}if(_>=0){var X=[];X[1]=_+1,X[0]=(1<<_+1)-1,L(X)}return U(65497),i.from(g)},(new Date).getTime(),t||(t=50),function(){for(var t=String.fromCharCode,e=0;e<256;e++)x[e]=t(e)}(),e=O(S,M),r=O(B,T),n=O(A,I),a=O(R,P),function(){for(var t=1,e=2,r=1;r<=15;r++){for(var i=t;i<e;i++)d[32767+i]=r,c[32767+i]=[],c[32767+i][1]=r,c[32767+i][0]=i;for(var n=-(e-1);n<=-t;n++)d[32767+n]=r,c[32767+n]=[],c[32767+n][1]=r,c[32767+n][0]=e-1+n;t<<=1,e<<=1}}(),function(){for(var t=0;t<256;t++)E[t]=19595*t,E[t+256>>0]=38470*t,E[t+512>>0]=7471*t+32768,E[t+768>>0]=-11059*t,E[t+1024>>0]=-21709*t,E[t+1280>>0]=32768*t+8421375,E[t+1536>>0]=-27439*t,E[t+1792>>0]=-5329*t}(),D(t),(new Date).getTime()}t.exports=function(t,e){return void 0===e&&(e=50),{data:new n(e).encode(t,e),width:t.width,height:t.height}}},8058:(t,e,r)=>{var i=r(8834).lW,n=r(6290),a=function(){},o=r(4398),s=r(5947),h=r(8438),l=r(5565),f=r(1960),u=self.XMLHttpRequest&&"withCredentials"in new XMLHttpRequest;t.exports=function(t,e){e="function"==typeof e?e:a,"string"==typeof t?t={uri:t}:t||(t={}),t.binary&&(t=function(t){if(u)return f(t,{responseType:"arraybuffer"});if(void 0===self.XMLHttpRequest)throw new Error("your browser does not support XHR loading");var e=new self.XMLHttpRequest;return e.overrideMimeType("text/plain; charset=x-user-defined"),f({xhr:e},t)}(t)),n(t,(function(r,n,f){if(r)return e(r);if(!/^2/.test(n.statusCode))return e(new Error("http status code: "+n.statusCode));if(!f)return e(new Error("no body result"));var u,c,d=!1;if(u=f,"[object ArrayBuffer]"===Object.prototype.toString.call(u)){var p=new Uint8Array(f);f=i.from(p,"binary")}l(f)&&(d=!0,"string"==typeof f&&(f=i.from(f,"binary"))),d||(i.isBuffer(f)&&(f=f.toString(t.encoding)),f=f.trim());try{var m=n.headers["content-type"];c=d?h(f):/json/.test(m)||"{"===f.charAt(0)?JSON.parse(f):/xml/.test(m)||"<"===f.charAt(0)?s(f):o(f)}catch(t){e(new Error("error parsing font "+t.message)),e=a}e(null,c)}))}},5565:(t,e,r)=>{var i=r(8834).lW,n=r(5137),a=i.from([66,77,70,3]);t.exports=function(t){return"string"==typeof t?"BMF"===t.substring(0,3):t.length>4&&n(t.slice(0,4),a)}},63:(t,e)=>{"use strict";function r(t,e,r,i){for(var n=t[e++],a=1<<n,o=a+1,s=o+1,h=n+1,l=(1<<h)-1,f=0,u=0,c=0,d=t[e++],p=new Int32Array(4096),m=null;;){for(;f<16&&0!==d;)u|=t[e++]<<f,f+=8,1===d?d=t[e++]:--d;if(f<h)break;var g=u&l;if(u>>=h,f-=h,g!==a){if(g===o)break;for(var b=g<s?g:m,_=0,y=b;y>a;)y=p[y]>>8,++_;var w=y;if(c+_+(b!==g?1:0)>i)return void console.log("Warning, gif stream longer than expected.");r[c++]=w;var v=c+=_;for(b!==g&&(r[c++]=w),y=b;_--;)y=p[y],r[--v]=255&y,y>>=8;null!==m&&s<4096&&(p[s++]=m<<8|w,s>=l+1&&h<12&&(++h,l=l<<1|1)),m=g}else s=o+1,l=(1<<(h=n+1))-1,m=null}return c!==i&&console.log("Warning, gif stream shorter than expected."),r}try{e.N=function(t){var e=0;if(71!==t[e++]||73!==t[e++]||70!==t[e++]||56!==t[e++]||56!=(t[e++]+1&253)||97!==t[e++])throw new Error("Invalid GIF 87a/89a header.");var i=t[e++]|t[e++]<<8,n=t[e++]|t[e++]<<8,a=t[e++],o=a>>7,s=1<<1+(7&a);t[e++],t[e++];var h=null,l=null;o&&(h=e,l=s,e+=3*s);var f=!0,u=[],c=0,d=null,p=0,m=null;for(this.width=i,this.height=n;f&&e<t.length;)switch(t[e++]){case 33:switch(t[e++]){case 255:if(11!==t[e]||78==t[e+1]&&69==t[e+2]&&84==t[e+3]&&83==t[e+4]&&67==t[e+5]&&65==t[e+6]&&80==t[e+7]&&69==t[e+8]&&50==t[e+9]&&46==t[e+10]&&48==t[e+11]&&3==t[e+12]&&1==t[e+13]&&0==t[e+16])e+=14,m=t[e++]|t[e++]<<8,e++;else for(e+=12;;){if(!((I=t[e++])>=0))throw Error("Invalid block size");if(0===I)break;e+=I}break;case 249:if(4!==t[e++]||0!==t[e+4])throw new Error("Invalid graphics extension block.");var g=t[e++];c=t[e++]|t[e++]<<8,d=t[e++],0==(1&g)&&(d=null),p=g>>2&7,e++;break;case 254:for(;;){if(!((I=t[e++])>=0))throw Error("Invalid block size");if(0===I)break;e+=I}break;default:throw new Error("Unknown graphic control label: 0x"+t[e-1].toString(16))}break;case 44:var b=t[e++]|t[e++]<<8,_=t[e++]|t[e++]<<8,y=t[e++]|t[e++]<<8,w=t[e++]|t[e++]<<8,v=t[e++],x=v>>6&1,E=1<<1+(7&v),k=h,S=l,M=!1;v>>7&&(M=!0,k=e,S=E,e+=3*E);var A=e;for(e++;;){var I;if(!((I=t[e++])>=0))throw Error("Invalid block size");if(0===I)break;e+=I}u.push({x:b,y:_,width:y,height:w,has_local_palette:M,palette_offset:k,palette_size:S,data_offset:A,data_length:e-A,transparent_index:d,interlaced:!!x,delay:c,disposal:p});break;case 59:f=!1;break;default:throw new Error("Unknown gif block: 0x"+t[e-1].toString(16))}this.numFrames=function(){return u.length},this.loopCount=function(){return m},this.frameInfo=function(t){if(t<0||t>=u.length)throw new Error("Frame index out of range.");return u[t]},this.decodeAndBlitFrameBGRA=function(e,n){var a=this.frameInfo(e),o=a.width*a.height,s=new Uint8Array(o);r(t,a.data_offset,s,o);var h=a.palette_offset,l=a.transparent_index;null===l&&(l=256);var f=a.width,u=i-f,c=f,d=4*(a.y*i+a.x),p=4*((a.y+a.height)*i+a.x),m=d,g=4*u;!0===a.interlaced&&(g+=4*i*7);for(var b=8,_=0,y=s.length;_<y;++_){var w=s[_];if(0===c&&(c=f,(m+=g)>=p&&(g=4*u+4*i*(b-1),m=d+(f+u)*(b<<1),b>>=1)),w===l)m+=4;else{var v=t[h+3*w],x=t[h+3*w+1],E=t[h+3*w+2];n[m++]=E,n[m++]=x,n[m++]=v,n[m++]=255}--c}},this.decodeAndBlitFrameRGBA=function(e,n){var a=this.frameInfo(e),o=a.width*a.height,s=new Uint8Array(o);r(t,a.data_offset,s,o);var h=a.palette_offset,l=a.transparent_index;null===l&&(l=256);var f=a.width,u=i-f,c=f,d=4*(a.y*i+a.x),p=4*((a.y+a.height)*i+a.x),m=d,g=4*u;!0===a.interlaced&&(g+=4*i*7);for(var b=8,_=0,y=s.length;_<y;++_){var w=s[_];if(0===c&&(c=f,(m+=g)>=p&&(g=4*u+4*i*(b-1),m=d+(f+u)*(b<<1),b>>=1)),w===l)m+=4;else{var v=t[h+3*w],x=t[h+3*w+1],E=t[h+3*w+2];n[m++]=v,n[m++]=x,n[m++]=E,n[m++]=255}--c}}}}catch(t){}},2845:(t,e,r)=>{"use strict";var i={};(0,r(9761).assign)(i,r(9880),r(1380),r(1271)),t.exports=i},9880:(t,e,r)=>{"use strict";var i=r(5789),n=r(9761),a=r(7944),o=r(2950),s=r(744),h=Object.prototype.toString,l=0,f=-1,u=0,c=8;function d(t){if(!(this instanceof d))return new d(t);this.options=n.assign({level:f,method:c,chunkSize:16384,windowBits:15,memLevel:8,strategy:u,to:""},t||{});var e=this.options;e.raw&&e.windowBits>0?e.windowBits=-e.windowBits:e.gzip&&e.windowBits>0&&e.windowBits<16&&(e.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new s,this.strm.avail_out=0;var r=i.deflateInit2(this.strm,e.level,e.method,e.windowBits,e.memLevel,e.strategy);if(r!==l)throw new Error(o[r]);if(e.header&&i.deflateSetHeader(this.strm,e.header),e.dictionary){var p;if(p="string"==typeof e.dictionary?a.string2buf(e.dictionary):"[object ArrayBuffer]"===h.call(e.dictionary)?new Uint8Array(e.dictionary):e.dictionary,(r=i.deflateSetDictionary(this.strm,p))!==l)throw new Error(o[r]);this._dict_set=!0}}function p(t,e){var r=new d(e);if(r.push(t,!0),r.err)throw r.msg||o[r.err];return r.result}d.prototype.push=function(t,e){var r,o,s=this.strm,f=this.options.chunkSize;if(this.ended)return!1;o=e===~~e?e:!0===e?4:0,"string"==typeof t?s.input=a.string2buf(t):"[object ArrayBuffer]"===h.call(t)?s.input=new Uint8Array(t):s.input=t,s.next_in=0,s.avail_in=s.input.length;do{if(0===s.avail_out&&(s.output=new n.Buf8(f),s.next_out=0,s.avail_out=f),1!==(r=i.deflate(s,o))&&r!==l)return this.onEnd(r),this.ended=!0,!1;0!==s.avail_out&&(0!==s.avail_in||4!==o&&2!==o)||("string"===this.options.to?this.onData(a.buf2binstring(n.shrinkBuf(s.output,s.next_out))):this.onData(n.shrinkBuf(s.output,s.next_out)))}while((s.avail_in>0||0===s.avail_out)&&1!==r);return 4===o?(r=i.deflateEnd(this.strm),this.onEnd(r),this.ended=!0,r===l):2!==o||(this.onEnd(l),s.avail_out=0,!0)},d.prototype.onData=function(t){this.chunks.push(t)},d.prototype.onEnd=function(t){t===l&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=n.flattenChunks(this.chunks)),this.chunks=[],this.err=t,this.msg=this.strm.msg},e.Deflate=d,e.deflate=p,e.deflateRaw=function(t,e){return(e=e||{}).raw=!0,p(t,e)},e.gzip=function(t,e){return(e=e||{}).gzip=!0,p(t,e)}},1380:(t,e,r)=>{"use strict";var i=r(5020),n=r(9761),a=r(7944),o=r(1271),s=r(2950),h=r(744),l=r(7357),f=Object.prototype.toString;function u(t){if(!(this instanceof u))return new u(t);this.options=n.assign({chunkSize:16384,windowBits:0,to:""},t||{});var e=this.options;e.raw&&e.windowBits>=0&&e.windowBits<16&&(e.windowBits=-e.windowBits,0===e.windowBits&&(e.windowBits=-15)),!(e.windowBits>=0&&e.windowBits<16)||t&&t.windowBits||(e.windowBits+=32),e.windowBits>15&&e.windowBits<48&&0==(15&e.windowBits)&&(e.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new h,this.strm.avail_out=0;var r=i.inflateInit2(this.strm,e.windowBits);if(r!==o.Z_OK)throw new Error(s[r]);if(this.header=new l,i.inflateGetHeader(this.strm,this.header),e.dictionary&&("string"==typeof e.dictionary?e.dictionary=a.string2buf(e.dictionary):"[object ArrayBuffer]"===f.call(e.dictionary)&&(e.dictionary=new Uint8Array(e.dictionary)),e.raw&&(r=i.inflateSetDictionary(this.strm,e.dictionary))!==o.Z_OK))throw new Error(s[r])}function c(t,e){var r=new u(e);if(r.push(t,!0),r.err)throw r.msg||s[r.err];return r.result}u.prototype.push=function(t,e){var r,s,h,l,u,c=this.strm,d=this.options.chunkSize,p=this.options.dictionary,m=!1;if(this.ended)return!1;s=e===~~e?e:!0===e?o.Z_FINISH:o.Z_NO_FLUSH,"string"==typeof t?c.input=a.binstring2buf(t):"[object ArrayBuffer]"===f.call(t)?c.input=new Uint8Array(t):c.input=t,c.next_in=0,c.avail_in=c.input.length;do{if(0===c.avail_out&&(c.output=new n.Buf8(d),c.next_out=0,c.avail_out=d),(r=i.inflate(c,o.Z_NO_FLUSH))===o.Z_NEED_DICT&&p&&(r=i.inflateSetDictionary(this.strm,p)),r===o.Z_BUF_ERROR&&!0===m&&(r=o.Z_OK,m=!1),r!==o.Z_STREAM_END&&r!==o.Z_OK)return this.onEnd(r),this.ended=!0,!1;c.next_out&&(0!==c.avail_out&&r!==o.Z_STREAM_END&&(0!==c.avail_in||s!==o.Z_FINISH&&s!==o.Z_SYNC_FLUSH)||("string"===this.options.to?(h=a.utf8border(c.output,c.next_out),l=c.next_out-h,u=a.buf2string(c.output,h),c.next_out=l,c.avail_out=d-l,l&&n.arraySet(c.output,c.output,h,l,0),this.onData(u)):this.onData(n.shrinkBuf(c.output,c.next_out)))),0===c.avail_in&&0===c.avail_out&&(m=!0)}while((c.avail_in>0||0===c.avail_out)&&r!==o.Z_STREAM_END);return r===o.Z_STREAM_END&&(s=o.Z_FINISH),s===o.Z_FINISH?(r=i.inflateEnd(this.strm),this.onEnd(r),this.ended=!0,r===o.Z_OK):s!==o.Z_SYNC_FLUSH||(this.onEnd(o.Z_OK),c.avail_out=0,!0)},u.prototype.onData=function(t){this.chunks.push(t)},u.prototype.onEnd=function(t){t===o.Z_OK&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=n.flattenChunks(this.chunks)),this.chunks=[],this.err=t,this.msg=this.strm.msg},e.Inflate=u,e.inflate=c,e.inflateRaw=function(t,e){return(e=e||{}).raw=!0,c(t,e)},e.ungzip=c},9761:(t,e)=>{"use strict";var r="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Int32Array;function i(t,e){return Object.prototype.hasOwnProperty.call(t,e)}e.assign=function(t){for(var e=Array.prototype.slice.call(arguments,1);e.length;){var r=e.shift();if(r){if("object"!=typeof r)throw new TypeError(r+"must be non-object");for(var n in r)i(r,n)&&(t[n]=r[n])}}return t},e.shrinkBuf=function(t,e){return t.length===e?t:t.subarray?t.subarray(0,e):(t.length=e,t)};var n={arraySet:function(t,e,r,i,n){if(e.subarray&&t.subarray)t.set(e.subarray(r,r+i),n);else for(var a=0;a<i;a++)t[n+a]=e[r+a]},flattenChunks:function(t){var e,r,i,n,a,o;for(i=0,e=0,r=t.length;e<r;e++)i+=t[e].length;for(o=new Uint8Array(i),n=0,e=0,r=t.length;e<r;e++)a=t[e],o.set(a,n),n+=a.length;return o}},a={arraySet:function(t,e,r,i,n){for(var a=0;a<i;a++)t[n+a]=e[r+a]},flattenChunks:function(t){return[].concat.apply([],t)}};e.setTyped=function(t){t?(e.Buf8=Uint8Array,e.Buf16=Uint16Array,e.Buf32=Int32Array,e.assign(e,n)):(e.Buf8=Array,e.Buf16=Array,e.Buf32=Array,e.assign(e,a))},e.setTyped(r)},7944:(t,e,r)=>{"use strict";var i=r(9761),n=!0,a=!0;try{String.fromCharCode.apply(null,[0])}catch(t){n=!1}try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(t){a=!1}for(var o=new i.Buf8(256),s=0;s<256;s++)o[s]=s>=252?6:s>=248?5:s>=240?4:s>=224?3:s>=192?2:1;function h(t,e){if(e<65534&&(t.subarray&&a||!t.subarray&&n))return String.fromCharCode.apply(null,i.shrinkBuf(t,e));for(var r="",o=0;o<e;o++)r+=String.fromCharCode(t[o]);return r}o[254]=o[254]=1,e.string2buf=function(t){var e,r,n,a,o,s=t.length,h=0;for(a=0;a<s;a++)55296==(64512&(r=t.charCodeAt(a)))&&a+1<s&&56320==(64512&(n=t.charCodeAt(a+1)))&&(r=65536+(r-55296<<10)+(n-56320),a++),h+=r<128?1:r<2048?2:r<65536?3:4;for(e=new i.Buf8(h),o=0,a=0;o<h;a++)55296==(64512&(r=t.charCodeAt(a)))&&a+1<s&&56320==(64512&(n=t.charCodeAt(a+1)))&&(r=65536+(r-55296<<10)+(n-56320),a++),r<128?e[o++]=r:r<2048?(e[o++]=192|r>>>6,e[o++]=128|63&r):r<65536?(e[o++]=224|r>>>12,e[o++]=128|r>>>6&63,e[o++]=128|63&r):(e[o++]=240|r>>>18,e[o++]=128|r>>>12&63,e[o++]=128|r>>>6&63,e[o++]=128|63&r);return e},e.buf2binstring=function(t){return h(t,t.length)},e.binstring2buf=function(t){for(var e=new i.Buf8(t.length),r=0,n=e.length;r<n;r++)e[r]=t.charCodeAt(r);return e},e.buf2string=function(t,e){var r,i,n,a,s=e||t.length,l=new Array(2*s);for(i=0,r=0;r<s;)if((n=t[r++])<128)l[i++]=n;else if((a=o[n])>4)l[i++]=65533,r+=a-1;else{for(n&=2===a?31:3===a?15:7;a>1&&r<s;)n=n<<6|63&t[r++],a--;a>1?l[i++]=65533:n<65536?l[i++]=n:(n-=65536,l[i++]=55296|n>>10&1023,l[i++]=56320|1023&n)}return h(l,i)},e.utf8border=function(t,e){var r;for((e=e||t.length)>t.length&&(e=t.length),r=e-1;r>=0&&128==(192&t[r]);)r--;return r<0||0===r?e:r+o[t[r]]>e?r:e}},5562:t=>{"use strict";t.exports=function(t,e,r,i){for(var n=65535&t|0,a=t>>>16&65535|0,o=0;0!==r;){r-=o=r>2e3?2e3:r;do{a=a+(n=n+e[i++]|0)|0}while(--o);n%=65521,a%=65521}return n|a<<16|0}},1271:t=>{"use strict";t.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8}},4299:t=>{"use strict";var e=function(){for(var t,e=[],r=0;r<256;r++){t=r;for(var i=0;i<8;i++)t=1&t?3988292384^t>>>1:t>>>1;e[r]=t}return e}();t.exports=function(t,r,i,n){var a=e,o=n+i;t^=-1;for(var s=n;s<o;s++)t=t>>>8^a[255&(t^r[s])];return-1^t}},5789:(t,e,r)=>{"use strict";var i,n=r(9761),a=r(9564),o=r(5562),s=r(4299),h=r(2950),l=0,f=4,u=0,c=-2,d=-1,p=1,m=4,g=2,b=8,_=9,y=286,w=30,v=19,x=2*y+1,E=15,k=3,S=258,M=S+k+1,A=42,I=103,B=113,T=666,R=1,P=2,O=3,L=4;function C(t,e){return t.msg=h[e],e}function U(t){return(t<<1)-(t>4?9:0)}function z(t){for(var e=t.length;--e>=0;)t[e]=0}function D(t){var e=t.state,r=e.pending;r>t.avail_out&&(r=t.avail_out),0!==r&&(n.arraySet(t.output,e.pending_buf,e.pending_out,r,t.next_out),t.next_out+=r,e.pending_out+=r,t.total_out+=r,t.avail_out-=r,e.pending-=r,0===e.pending&&(e.pending_out=0))}function N(t,e){a._tr_flush_block(t,t.block_start>=0?t.block_start:-1,t.strstart-t.block_start,e),t.block_start=t.strstart,D(t.strm)}function F(t,e){t.pending_buf[t.pending++]=e}function j(t,e){t.pending_buf[t.pending++]=e>>>8&255,t.pending_buf[t.pending++]=255&e}function G(t,e){var r,i,n=t.max_chain_length,a=t.strstart,o=t.prev_length,s=t.nice_match,h=t.strstart>t.w_size-M?t.strstart-(t.w_size-M):0,l=t.window,f=t.w_mask,u=t.prev,c=t.strstart+S,d=l[a+o-1],p=l[a+o];t.prev_length>=t.good_match&&(n>>=2),s>t.lookahead&&(s=t.lookahead);do{if(l[(r=e)+o]===p&&l[r+o-1]===d&&l[r]===l[a]&&l[++r]===l[a+1]){a+=2,r++;do{}while(l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&a<c);if(i=S-(c-a),a=c-S,i>o){if(t.match_start=e,o=i,i>=s)break;d=l[a+o-1],p=l[a+o]}}}while((e=u[e&f])>h&&0!=--n);return o<=t.lookahead?o:t.lookahead}function H(t){var e,r,i,a,h,l,f,u,c,d,p=t.w_size;do{if(a=t.window_size-t.lookahead-t.strstart,t.strstart>=p+(p-M)){n.arraySet(t.window,t.window,p,p,0),t.match_start-=p,t.strstart-=p,t.block_start-=p,e=r=t.hash_size;do{i=t.head[--e],t.head[e]=i>=p?i-p:0}while(--r);e=r=p;do{i=t.prev[--e],t.prev[e]=i>=p?i-p:0}while(--r);a+=p}if(0===t.strm.avail_in)break;if(l=t.strm,f=t.window,u=t.strstart+t.lookahead,c=a,d=void 0,(d=l.avail_in)>c&&(d=c),r=0===d?0:(l.avail_in-=d,n.arraySet(f,l.input,l.next_in,d,u),1===l.state.wrap?l.adler=o(l.adler,f,d,u):2===l.state.wrap&&(l.adler=s(l.adler,f,d,u)),l.next_in+=d,l.total_in+=d,d),t.lookahead+=r,t.lookahead+t.insert>=k)for(h=t.strstart-t.insert,t.ins_h=t.window[h],t.ins_h=(t.ins_h<<t.hash_shift^t.window[h+1])&t.hash_mask;t.insert&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[h+k-1])&t.hash_mask,t.prev[h&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=h,h++,t.insert--,!(t.lookahead+t.insert<k)););}while(t.lookahead<M&&0!==t.strm.avail_in)}function W(t,e){for(var r,i;;){if(t.lookahead<M){if(H(t),t.lookahead<M&&e===l)return R;if(0===t.lookahead)break}if(r=0,t.lookahead>=k&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+k-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),0!==r&&t.strstart-r<=t.w_size-M&&(t.match_length=G(t,r)),t.match_length>=k)if(i=a._tr_tally(t,t.strstart-t.match_start,t.match_length-k),t.lookahead-=t.match_length,t.match_length<=t.max_lazy_match&&t.lookahead>=k){t.match_length--;do{t.strstart++,t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+k-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart}while(0!=--t.match_length);t.strstart++}else t.strstart+=t.match_length,t.match_length=0,t.ins_h=t.window[t.strstart],t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+1])&t.hash_mask;else i=a._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++;if(i&&(N(t,!1),0===t.strm.avail_out))return R}return t.insert=t.strstart<k-1?t.strstart:k-1,e===f?(N(t,!0),0===t.strm.avail_out?O:L):t.last_lit&&(N(t,!1),0===t.strm.avail_out)?R:P}function q(t,e){for(var r,i,n;;){if(t.lookahead<M){if(H(t),t.lookahead<M&&e===l)return R;if(0===t.lookahead)break}if(r=0,t.lookahead>=k&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+k-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),t.prev_length=t.match_length,t.prev_match=t.match_start,t.match_length=k-1,0!==r&&t.prev_length<t.max_lazy_match&&t.strstart-r<=t.w_size-M&&(t.match_length=G(t,r),t.match_length<=5&&(t.strategy===p||t.match_length===k&&t.strstart-t.match_start>4096)&&(t.match_length=k-1)),t.prev_length>=k&&t.match_length<=t.prev_length){n=t.strstart+t.lookahead-k,i=a._tr_tally(t,t.strstart-1-t.prev_match,t.prev_length-k),t.lookahead-=t.prev_length-1,t.prev_length-=2;do{++t.strstart<=n&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+k-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart)}while(0!=--t.prev_length);if(t.match_available=0,t.match_length=k-1,t.strstart++,i&&(N(t,!1),0===t.strm.avail_out))return R}else if(t.match_available){if((i=a._tr_tally(t,0,t.window[t.strstart-1]))&&N(t,!1),t.strstart++,t.lookahead--,0===t.strm.avail_out)return R}else t.match_available=1,t.strstart++,t.lookahead--}return t.match_available&&(i=a._tr_tally(t,0,t.window[t.strstart-1]),t.match_available=0),t.insert=t.strstart<k-1?t.strstart:k-1,e===f?(N(t,!0),0===t.strm.avail_out?O:L):t.last_lit&&(N(t,!1),0===t.strm.avail_out)?R:P}function Z(t,e,r,i,n){this.good_length=t,this.max_lazy=e,this.nice_length=r,this.max_chain=i,this.func=n}function Y(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=b,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new n.Buf16(2*x),this.dyn_dtree=new n.Buf16(2*(2*w+1)),this.bl_tree=new n.Buf16(2*(2*v+1)),z(this.dyn_ltree),z(this.dyn_dtree),z(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new n.Buf16(E+1),this.heap=new n.Buf16(2*y+1),z(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new n.Buf16(2*y+1),z(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function V(t){var e;return t&&t.state?(t.total_in=t.total_out=0,t.data_type=g,(e=t.state).pending=0,e.pending_out=0,e.wrap<0&&(e.wrap=-e.wrap),e.status=e.wrap?A:B,t.adler=2===e.wrap?0:1,e.last_flush=l,a._tr_init(e),u):C(t,c)}function X(t){var e,r=V(t);return r===u&&((e=t.state).window_size=2*e.w_size,z(e.head),e.max_lazy_match=i[e.level].max_lazy,e.good_match=i[e.level].good_length,e.nice_match=i[e.level].nice_length,e.max_chain_length=i[e.level].max_chain,e.strstart=0,e.block_start=0,e.lookahead=0,e.insert=0,e.match_length=e.prev_length=k-1,e.match_available=0,e.ins_h=0),r}function J(t,e,r,i,a,o){if(!t)return c;var s=1;if(e===d&&(e=6),i<0?(s=0,i=-i):i>15&&(s=2,i-=16),a<1||a>_||r!==b||i<8||i>15||e<0||e>9||o<0||o>m)return C(t,c);8===i&&(i=9);var h=new Y;return t.state=h,h.strm=t,h.wrap=s,h.gzhead=null,h.w_bits=i,h.w_size=1<<h.w_bits,h.w_mask=h.w_size-1,h.hash_bits=a+7,h.hash_size=1<<h.hash_bits,h.hash_mask=h.hash_size-1,h.hash_shift=~~((h.hash_bits+k-1)/k),h.window=new n.Buf8(2*h.w_size),h.head=new n.Buf16(h.hash_size),h.prev=new n.Buf16(h.w_size),h.lit_bufsize=1<<a+6,h.pending_buf_size=4*h.lit_bufsize,h.pending_buf=new n.Buf8(h.pending_buf_size),h.d_buf=1*h.lit_bufsize,h.l_buf=3*h.lit_bufsize,h.level=e,h.strategy=o,h.method=r,X(t)}i=[new Z(0,0,0,0,(function(t,e){var r=65535;for(r>t.pending_buf_size-5&&(r=t.pending_buf_size-5);;){if(t.lookahead<=1){if(H(t),0===t.lookahead&&e===l)return R;if(0===t.lookahead)break}t.strstart+=t.lookahead,t.lookahead=0;var i=t.block_start+r;if((0===t.strstart||t.strstart>=i)&&(t.lookahead=t.strstart-i,t.strstart=i,N(t,!1),0===t.strm.avail_out))return R;if(t.strstart-t.block_start>=t.w_size-M&&(N(t,!1),0===t.strm.avail_out))return R}return t.insert=0,e===f?(N(t,!0),0===t.strm.avail_out?O:L):(t.strstart>t.block_start&&(N(t,!1),t.strm.avail_out),R)})),new Z(4,4,8,4,W),new Z(4,5,16,8,W),new Z(4,6,32,32,W),new Z(4,4,16,16,q),new Z(8,16,32,32,q),new Z(8,16,128,128,q),new Z(8,32,128,256,q),new Z(32,128,258,1024,q),new Z(32,258,258,4096,q)],e.deflateInit=function(t,e){return J(t,e,b,15,8,0)},e.deflateInit2=J,e.deflateReset=X,e.deflateResetKeep=V,e.deflateSetHeader=function(t,e){return t&&t.state?2!==t.state.wrap?c:(t.state.gzhead=e,u):c},e.deflate=function(t,e){var r,n,o,h;if(!t||!t.state||e>5||e<0)return t?C(t,c):c;if(n=t.state,!t.output||!t.input&&0!==t.avail_in||n.status===T&&e!==f)return C(t,0===t.avail_out?-5:c);if(n.strm=t,r=n.last_flush,n.last_flush=e,n.status===A)if(2===n.wrap)t.adler=0,F(n,31),F(n,139),F(n,8),n.gzhead?(F(n,(n.gzhead.text?1:0)+(n.gzhead.hcrc?2:0)+(n.gzhead.extra?4:0)+(n.gzhead.name?8:0)+(n.gzhead.comment?16:0)),F(n,255&n.gzhead.time),F(n,n.gzhead.time>>8&255),F(n,n.gzhead.time>>16&255),F(n,n.gzhead.time>>24&255),F(n,9===n.level?2:n.strategy>=2||n.level<2?4:0),F(n,255&n.gzhead.os),n.gzhead.extra&&n.gzhead.extra.length&&(F(n,255&n.gzhead.extra.length),F(n,n.gzhead.extra.length>>8&255)),n.gzhead.hcrc&&(t.adler=s(t.adler,n.pending_buf,n.pending,0)),n.gzindex=0,n.status=69):(F(n,0),F(n,0),F(n,0),F(n,0),F(n,0),F(n,9===n.level?2:n.strategy>=2||n.level<2?4:0),F(n,3),n.status=B);else{var d=b+(n.w_bits-8<<4)<<8;d|=(n.strategy>=2||n.level<2?0:n.level<6?1:6===n.level?2:3)<<6,0!==n.strstart&&(d|=32),d+=31-d%31,n.status=B,j(n,d),0!==n.strstart&&(j(n,t.adler>>>16),j(n,65535&t.adler)),t.adler=1}if(69===n.status)if(n.gzhead.extra){for(o=n.pending;n.gzindex<(65535&n.gzhead.extra.length)&&(n.pending!==n.pending_buf_size||(n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),D(t),o=n.pending,n.pending!==n.pending_buf_size));)F(n,255&n.gzhead.extra[n.gzindex]),n.gzindex++;n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),n.gzindex===n.gzhead.extra.length&&(n.gzindex=0,n.status=73)}else n.status=73;if(73===n.status)if(n.gzhead.name){o=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),D(t),o=n.pending,n.pending===n.pending_buf_size)){h=1;break}h=n.gzindex<n.gzhead.name.length?255&n.gzhead.name.charCodeAt(n.gzindex++):0,F(n,h)}while(0!==h);n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),0===h&&(n.gzindex=0,n.status=91)}else n.status=91;if(91===n.status)if(n.gzhead.comment){o=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),D(t),o=n.pending,n.pending===n.pending_buf_size)){h=1;break}h=n.gzindex<n.gzhead.comment.length?255&n.gzhead.comment.charCodeAt(n.gzindex++):0,F(n,h)}while(0!==h);n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),0===h&&(n.status=I)}else n.status=I;if(n.status===I&&(n.gzhead.hcrc?(n.pending+2>n.pending_buf_size&&D(t),n.pending+2<=n.pending_buf_size&&(F(n,255&t.adler),F(n,t.adler>>8&255),t.adler=0,n.status=B)):n.status=B),0!==n.pending){if(D(t),0===t.avail_out)return n.last_flush=-1,u}else if(0===t.avail_in&&U(e)<=U(r)&&e!==f)return C(t,-5);if(n.status===T&&0!==t.avail_in)return C(t,-5);if(0!==t.avail_in||0!==n.lookahead||e!==l&&n.status!==T){var p=2===n.strategy?function(t,e){for(var r;;){if(0===t.lookahead&&(H(t),0===t.lookahead)){if(e===l)return R;break}if(t.match_length=0,r=a._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++,r&&(N(t,!1),0===t.strm.avail_out))return R}return t.insert=0,e===f?(N(t,!0),0===t.strm.avail_out?O:L):t.last_lit&&(N(t,!1),0===t.strm.avail_out)?R:P}(n,e):3===n.strategy?function(t,e){for(var r,i,n,o,s=t.window;;){if(t.lookahead<=S){if(H(t),t.lookahead<=S&&e===l)return R;if(0===t.lookahead)break}if(t.match_length=0,t.lookahead>=k&&t.strstart>0&&(i=s[n=t.strstart-1])===s[++n]&&i===s[++n]&&i===s[++n]){o=t.strstart+S;do{}while(i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&n<o);t.match_length=S-(o-n),t.match_length>t.lookahead&&(t.match_length=t.lookahead)}if(t.match_length>=k?(r=a._tr_tally(t,1,t.match_length-k),t.lookahead-=t.match_length,t.strstart+=t.match_length,t.match_length=0):(r=a._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++),r&&(N(t,!1),0===t.strm.avail_out))return R}return t.insert=0,e===f?(N(t,!0),0===t.strm.avail_out?O:L):t.last_lit&&(N(t,!1),0===t.strm.avail_out)?R:P}(n,e):i[n.level].func(n,e);if(p!==O&&p!==L||(n.status=T),p===R||p===O)return 0===t.avail_out&&(n.last_flush=-1),u;if(p===P&&(1===e?a._tr_align(n):5!==e&&(a._tr_stored_block(n,0,0,!1),3===e&&(z(n.head),0===n.lookahead&&(n.strstart=0,n.block_start=0,n.insert=0))),D(t),0===t.avail_out))return n.last_flush=-1,u}return e!==f?u:n.wrap<=0?1:(2===n.wrap?(F(n,255&t.adler),F(n,t.adler>>8&255),F(n,t.adler>>16&255),F(n,t.adler>>24&255),F(n,255&t.total_in),F(n,t.total_in>>8&255),F(n,t.total_in>>16&255),F(n,t.total_in>>24&255)):(j(n,t.adler>>>16),j(n,65535&t.adler)),D(t),n.wrap>0&&(n.wrap=-n.wrap),0!==n.pending?u:1)},e.deflateEnd=function(t){var e;return t&&t.state?(e=t.state.status)!==A&&69!==e&&73!==e&&91!==e&&e!==I&&e!==B&&e!==T?C(t,c):(t.state=null,e===B?C(t,-3):u):c},e.deflateSetDictionary=function(t,e){var r,i,a,s,h,l,f,d,p=e.length;if(!t||!t.state)return c;if(2===(s=(r=t.state).wrap)||1===s&&r.status!==A||r.lookahead)return c;for(1===s&&(t.adler=o(t.adler,e,p,0)),r.wrap=0,p>=r.w_size&&(0===s&&(z(r.head),r.strstart=0,r.block_start=0,r.insert=0),d=new n.Buf8(r.w_size),n.arraySet(d,e,p-r.w_size,r.w_size,0),e=d,p=r.w_size),h=t.avail_in,l=t.next_in,f=t.input,t.avail_in=p,t.next_in=0,t.input=e,H(r);r.lookahead>=k;){i=r.strstart,a=r.lookahead-(k-1);do{r.ins_h=(r.ins_h<<r.hash_shift^r.window[i+k-1])&r.hash_mask,r.prev[i&r.w_mask]=r.head[r.ins_h],r.head[r.ins_h]=i,i++}while(--a);r.strstart=i,r.lookahead=k-1,H(r)}return r.strstart+=r.lookahead,r.block_start=r.strstart,r.insert=r.lookahead,r.lookahead=0,r.match_length=r.prev_length=k-1,r.match_available=0,t.next_in=l,t.input=f,t.avail_in=h,r.wrap=s,u},e.deflateInfo="pako deflate (from Nodeca project)"},7357:t=>{"use strict";t.exports=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1}},4980:t=>{"use strict";t.exports=function(t,e){var r,i,n,a,o,s,h,l,f,u,c,d,p,m,g,b,_,y,w,v,x,E,k,S,M;r=t.state,i=t.next_in,S=t.input,n=i+(t.avail_in-5),a=t.next_out,M=t.output,o=a-(e-t.avail_out),s=a+(t.avail_out-257),h=r.dmax,l=r.wsize,f=r.whave,u=r.wnext,c=r.window,d=r.hold,p=r.bits,m=r.lencode,g=r.distcode,b=(1<<r.lenbits)-1,_=(1<<r.distbits)-1;t:do{p<15&&(d+=S[i++]<<p,p+=8,d+=S[i++]<<p,p+=8),y=m[d&b];e:for(;;){if(d>>>=w=y>>>24,p-=w,0==(w=y>>>16&255))M[a++]=65535&y;else{if(!(16&w)){if(0==(64&w)){y=m[(65535&y)+(d&(1<<w)-1)];continue e}if(32&w){r.mode=12;break t}t.msg="invalid literal/length code",r.mode=30;break t}v=65535&y,(w&=15)&&(p<w&&(d+=S[i++]<<p,p+=8),v+=d&(1<<w)-1,d>>>=w,p-=w),p<15&&(d+=S[i++]<<p,p+=8,d+=S[i++]<<p,p+=8),y=g[d&_];r:for(;;){if(d>>>=w=y>>>24,p-=w,!(16&(w=y>>>16&255))){if(0==(64&w)){y=g[(65535&y)+(d&(1<<w)-1)];continue r}t.msg="invalid distance code",r.mode=30;break t}if(x=65535&y,p<(w&=15)&&(d+=S[i++]<<p,(p+=8)<w&&(d+=S[i++]<<p,p+=8)),(x+=d&(1<<w)-1)>h){t.msg="invalid distance too far back",r.mode=30;break t}if(d>>>=w,p-=w,x>(w=a-o)){if((w=x-w)>f&&r.sane){t.msg="invalid distance too far back",r.mode=30;break t}if(E=0,k=c,0===u){if(E+=l-w,w<v){v-=w;do{M[a++]=c[E++]}while(--w);E=a-x,k=M}}else if(u<w){if(E+=l+u-w,(w-=u)<v){v-=w;do{M[a++]=c[E++]}while(--w);if(E=0,u<v){v-=w=u;do{M[a++]=c[E++]}while(--w);E=a-x,k=M}}}else if(E+=u-w,w<v){v-=w;do{M[a++]=c[E++]}while(--w);E=a-x,k=M}for(;v>2;)M[a++]=k[E++],M[a++]=k[E++],M[a++]=k[E++],v-=3;v&&(M[a++]=k[E++],v>1&&(M[a++]=k[E++]))}else{E=a-x;do{M[a++]=M[E++],M[a++]=M[E++],M[a++]=M[E++],v-=3}while(v>2);v&&(M[a++]=M[E++],v>1&&(M[a++]=M[E++]))}break}}break}}while(i<n&&a<s);i-=v=p>>3,d&=(1<<(p-=v<<3))-1,t.next_in=i,t.next_out=a,t.avail_in=i<n?n-i+5:5-(i-n),t.avail_out=a<s?s-a+257:257-(a-s),r.hold=d,r.bits=p}},5020:(t,e,r)=>{"use strict";var i=r(9761),n=r(5562),a=r(4299),o=r(4980),s=r(881),h=1,l=2,f=0,u=-2,c=1,d=12,p=30,m=852,g=592;function b(t){return(t>>>24&255)+(t>>>8&65280)+((65280&t)<<8)+((255&t)<<24)}function _(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new i.Buf16(320),this.work=new i.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}function y(t){var e;return t&&t.state?(e=t.state,t.total_in=t.total_out=e.total=0,t.msg="",e.wrap&&(t.adler=1&e.wrap),e.mode=c,e.last=0,e.havedict=0,e.dmax=32768,e.head=null,e.hold=0,e.bits=0,e.lencode=e.lendyn=new i.Buf32(m),e.distcode=e.distdyn=new i.Buf32(g),e.sane=1,e.back=-1,f):u}function w(t){var e;return t&&t.state?((e=t.state).wsize=0,e.whave=0,e.wnext=0,y(t)):u}function v(t,e){var r,i;return t&&t.state?(i=t.state,e<0?(r=0,e=-e):(r=1+(e>>4),e<48&&(e&=15)),e&&(e<8||e>15)?u:(null!==i.window&&i.wbits!==e&&(i.window=null),i.wrap=r,i.wbits=e,w(t))):u}function x(t,e){var r,i;return t?(i=new _,t.state=i,i.window=null,(r=v(t,e))!==f&&(t.state=null),r):u}var E,k,S=!0;function M(t){if(S){var e;for(E=new i.Buf32(512),k=new i.Buf32(32),e=0;e<144;)t.lens[e++]=8;for(;e<256;)t.lens[e++]=9;for(;e<280;)t.lens[e++]=7;for(;e<288;)t.lens[e++]=8;for(s(h,t.lens,0,288,E,0,t.work,{bits:9}),e=0;e<32;)t.lens[e++]=5;s(l,t.lens,0,32,k,0,t.work,{bits:5}),S=!1}t.lencode=E,t.lenbits=9,t.distcode=k,t.distbits=5}function A(t,e,r,n){var a,o=t.state;return null===o.window&&(o.wsize=1<<o.wbits,o.wnext=0,o.whave=0,o.window=new i.Buf8(o.wsize)),n>=o.wsize?(i.arraySet(o.window,e,r-o.wsize,o.wsize,0),o.wnext=0,o.whave=o.wsize):((a=o.wsize-o.wnext)>n&&(a=n),i.arraySet(o.window,e,r-n,a,o.wnext),(n-=a)?(i.arraySet(o.window,e,r-n,n,0),o.wnext=n,o.whave=o.wsize):(o.wnext+=a,o.wnext===o.wsize&&(o.wnext=0),o.whave<o.wsize&&(o.whave+=a))),0}e.inflateReset=w,e.inflateReset2=v,e.inflateResetKeep=y,e.inflateInit=function(t){return x(t,15)},e.inflateInit2=x,e.inflate=function(t,e){var r,m,g,_,y,w,v,x,E,k,S,I,B,T,R,P,O,L,C,U,z,D,N,F,j=0,G=new i.Buf8(4),H=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!t||!t.state||!t.output||!t.input&&0!==t.avail_in)return u;(r=t.state).mode===d&&(r.mode=13),y=t.next_out,g=t.output,v=t.avail_out,_=t.next_in,m=t.input,w=t.avail_in,x=r.hold,E=r.bits,k=w,S=v,D=f;t:for(;;)switch(r.mode){case c:if(0===r.wrap){r.mode=13;break}for(;E<16;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(2&r.wrap&&35615===x){r.check=0,G[0]=255&x,G[1]=x>>>8&255,r.check=a(r.check,G,2,0),x=0,E=0,r.mode=2;break}if(r.flags=0,r.head&&(r.head.done=!1),!(1&r.wrap)||(((255&x)<<8)+(x>>8))%31){t.msg="incorrect header check",r.mode=p;break}if(8!=(15&x)){t.msg="unknown compression method",r.mode=p;break}if(E-=4,z=8+(15&(x>>>=4)),0===r.wbits)r.wbits=z;else if(z>r.wbits){t.msg="invalid window size",r.mode=p;break}r.dmax=1<<z,t.adler=r.check=1,r.mode=512&x?10:d,x=0,E=0;break;case 2:for(;E<16;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(r.flags=x,8!=(255&r.flags)){t.msg="unknown compression method",r.mode=p;break}if(57344&r.flags){t.msg="unknown header flags set",r.mode=p;break}r.head&&(r.head.text=x>>8&1),512&r.flags&&(G[0]=255&x,G[1]=x>>>8&255,r.check=a(r.check,G,2,0)),x=0,E=0,r.mode=3;case 3:for(;E<32;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}r.head&&(r.head.time=x),512&r.flags&&(G[0]=255&x,G[1]=x>>>8&255,G[2]=x>>>16&255,G[3]=x>>>24&255,r.check=a(r.check,G,4,0)),x=0,E=0,r.mode=4;case 4:for(;E<16;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}r.head&&(r.head.xflags=255&x,r.head.os=x>>8),512&r.flags&&(G[0]=255&x,G[1]=x>>>8&255,r.check=a(r.check,G,2,0)),x=0,E=0,r.mode=5;case 5:if(1024&r.flags){for(;E<16;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}r.length=x,r.head&&(r.head.extra_len=x),512&r.flags&&(G[0]=255&x,G[1]=x>>>8&255,r.check=a(r.check,G,2,0)),x=0,E=0}else r.head&&(r.head.extra=null);r.mode=6;case 6:if(1024&r.flags&&((I=r.length)>w&&(I=w),I&&(r.head&&(z=r.head.extra_len-r.length,r.head.extra||(r.head.extra=new Array(r.head.extra_len)),i.arraySet(r.head.extra,m,_,I,z)),512&r.flags&&(r.check=a(r.check,m,I,_)),w-=I,_+=I,r.length-=I),r.length))break t;r.length=0,r.mode=7;case 7:if(2048&r.flags){if(0===w)break t;I=0;do{z=m[_+I++],r.head&&z&&r.length<65536&&(r.head.name+=String.fromCharCode(z))}while(z&&I<w);if(512&r.flags&&(r.check=a(r.check,m,I,_)),w-=I,_+=I,z)break t}else r.head&&(r.head.name=null);r.length=0,r.mode=8;case 8:if(4096&r.flags){if(0===w)break t;I=0;do{z=m[_+I++],r.head&&z&&r.length<65536&&(r.head.comment+=String.fromCharCode(z))}while(z&&I<w);if(512&r.flags&&(r.check=a(r.check,m,I,_)),w-=I,_+=I,z)break t}else r.head&&(r.head.comment=null);r.mode=9;case 9:if(512&r.flags){for(;E<16;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(x!==(65535&r.check)){t.msg="header crc mismatch",r.mode=p;break}x=0,E=0}r.head&&(r.head.hcrc=r.flags>>9&1,r.head.done=!0),t.adler=r.check=0,r.mode=d;break;case 10:for(;E<32;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}t.adler=r.check=b(x),x=0,E=0,r.mode=11;case 11:if(0===r.havedict)return t.next_out=y,t.avail_out=v,t.next_in=_,t.avail_in=w,r.hold=x,r.bits=E,2;t.adler=r.check=1,r.mode=d;case d:if(5===e||6===e)break t;case 13:if(r.last){x>>>=7&E,E-=7&E,r.mode=27;break}for(;E<3;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}switch(r.last=1&x,E-=1,3&(x>>>=1)){case 0:r.mode=14;break;case 1:if(M(r),r.mode=20,6===e){x>>>=2,E-=2;break t}break;case 2:r.mode=17;break;case 3:t.msg="invalid block type",r.mode=p}x>>>=2,E-=2;break;case 14:for(x>>>=7&E,E-=7&E;E<32;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if((65535&x)!=(x>>>16^65535)){t.msg="invalid stored block lengths",r.mode=p;break}if(r.length=65535&x,x=0,E=0,r.mode=15,6===e)break t;case 15:r.mode=16;case 16:if(I=r.length){if(I>w&&(I=w),I>v&&(I=v),0===I)break t;i.arraySet(g,m,_,I,y),w-=I,_+=I,v-=I,y+=I,r.length-=I;break}r.mode=d;break;case 17:for(;E<14;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(r.nlen=257+(31&x),x>>>=5,E-=5,r.ndist=1+(31&x),x>>>=5,E-=5,r.ncode=4+(15&x),x>>>=4,E-=4,r.nlen>286||r.ndist>30){t.msg="too many length or distance symbols",r.mode=p;break}r.have=0,r.mode=18;case 18:for(;r.have<r.ncode;){for(;E<3;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}r.lens[H[r.have++]]=7&x,x>>>=3,E-=3}for(;r.have<19;)r.lens[H[r.have++]]=0;if(r.lencode=r.lendyn,r.lenbits=7,N={bits:r.lenbits},D=s(0,r.lens,0,19,r.lencode,0,r.work,N),r.lenbits=N.bits,D){t.msg="invalid code lengths set",r.mode=p;break}r.have=0,r.mode=19;case 19:for(;r.have<r.nlen+r.ndist;){for(;P=(j=r.lencode[x&(1<<r.lenbits)-1])>>>16&255,O=65535&j,!((R=j>>>24)<=E);){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(O<16)x>>>=R,E-=R,r.lens[r.have++]=O;else{if(16===O){for(F=R+2;E<F;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(x>>>=R,E-=R,0===r.have){t.msg="invalid bit length repeat",r.mode=p;break}z=r.lens[r.have-1],I=3+(3&x),x>>>=2,E-=2}else if(17===O){for(F=R+3;E<F;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}E-=R,z=0,I=3+(7&(x>>>=R)),x>>>=3,E-=3}else{for(F=R+7;E<F;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}E-=R,z=0,I=11+(127&(x>>>=R)),x>>>=7,E-=7}if(r.have+I>r.nlen+r.ndist){t.msg="invalid bit length repeat",r.mode=p;break}for(;I--;)r.lens[r.have++]=z}}if(r.mode===p)break;if(0===r.lens[256]){t.msg="invalid code -- missing end-of-block",r.mode=p;break}if(r.lenbits=9,N={bits:r.lenbits},D=s(h,r.lens,0,r.nlen,r.lencode,0,r.work,N),r.lenbits=N.bits,D){t.msg="invalid literal/lengths set",r.mode=p;break}if(r.distbits=6,r.distcode=r.distdyn,N={bits:r.distbits},D=s(l,r.lens,r.nlen,r.ndist,r.distcode,0,r.work,N),r.distbits=N.bits,D){t.msg="invalid distances set",r.mode=p;break}if(r.mode=20,6===e)break t;case 20:r.mode=21;case 21:if(w>=6&&v>=258){t.next_out=y,t.avail_out=v,t.next_in=_,t.avail_in=w,r.hold=x,r.bits=E,o(t,S),y=t.next_out,g=t.output,v=t.avail_out,_=t.next_in,m=t.input,w=t.avail_in,x=r.hold,E=r.bits,r.mode===d&&(r.back=-1);break}for(r.back=0;P=(j=r.lencode[x&(1<<r.lenbits)-1])>>>16&255,O=65535&j,!((R=j>>>24)<=E);){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(P&&0==(240&P)){for(L=R,C=P,U=O;P=(j=r.lencode[U+((x&(1<<L+C)-1)>>L)])>>>16&255,O=65535&j,!(L+(R=j>>>24)<=E);){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}x>>>=L,E-=L,r.back+=L}if(x>>>=R,E-=R,r.back+=R,r.length=O,0===P){r.mode=26;break}if(32&P){r.back=-1,r.mode=d;break}if(64&P){t.msg="invalid literal/length code",r.mode=p;break}r.extra=15&P,r.mode=22;case 22:if(r.extra){for(F=r.extra;E<F;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}r.length+=x&(1<<r.extra)-1,x>>>=r.extra,E-=r.extra,r.back+=r.extra}r.was=r.length,r.mode=23;case 23:for(;P=(j=r.distcode[x&(1<<r.distbits)-1])>>>16&255,O=65535&j,!((R=j>>>24)<=E);){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(0==(240&P)){for(L=R,C=P,U=O;P=(j=r.distcode[U+((x&(1<<L+C)-1)>>L)])>>>16&255,O=65535&j,!(L+(R=j>>>24)<=E);){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}x>>>=L,E-=L,r.back+=L}if(x>>>=R,E-=R,r.back+=R,64&P){t.msg="invalid distance code",r.mode=p;break}r.offset=O,r.extra=15&P,r.mode=24;case 24:if(r.extra){for(F=r.extra;E<F;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}r.offset+=x&(1<<r.extra)-1,x>>>=r.extra,E-=r.extra,r.back+=r.extra}if(r.offset>r.dmax){t.msg="invalid distance too far back",r.mode=p;break}r.mode=25;case 25:if(0===v)break t;if(I=S-v,r.offset>I){if((I=r.offset-I)>r.whave&&r.sane){t.msg="invalid distance too far back",r.mode=p;break}I>r.wnext?(I-=r.wnext,B=r.wsize-I):B=r.wnext-I,I>r.length&&(I=r.length),T=r.window}else T=g,B=y-r.offset,I=r.length;I>v&&(I=v),v-=I,r.length-=I;do{g[y++]=T[B++]}while(--I);0===r.length&&(r.mode=21);break;case 26:if(0===v)break t;g[y++]=r.length,v--,r.mode=21;break;case 27:if(r.wrap){for(;E<32;){if(0===w)break t;w--,x|=m[_++]<<E,E+=8}if(S-=v,t.total_out+=S,r.total+=S,S&&(t.adler=r.check=r.flags?a(r.check,g,S,y-S):n(r.check,g,S,y-S)),S=v,(r.flags?x:b(x))!==r.check){t.msg="incorrect data check",r.mode=p;break}x=0,E=0}r.mode=28;case 28:if(r.wrap&&r.flags){for(;E<32;){if(0===w)break t;w--,x+=m[_++]<<E,E+=8}if(x!==(4294967295&r.total)){t.msg="incorrect length check",r.mode=p;break}x=0,E=0}r.mode=29;case 29:D=1;break t;case p:D=-3;break t;case 31:return-4;default:return u}return t.next_out=y,t.avail_out=v,t.next_in=_,t.avail_in=w,r.hold=x,r.bits=E,(r.wsize||S!==t.avail_out&&r.mode<p&&(r.mode<27||4!==e))&&A(t,t.output,t.next_out,S-t.avail_out)?(r.mode=31,-4):(k-=t.avail_in,S-=t.avail_out,t.total_in+=k,t.total_out+=S,r.total+=S,r.wrap&&S&&(t.adler=r.check=r.flags?a(r.check,g,S,t.next_out-S):n(r.check,g,S,t.next_out-S)),t.data_type=r.bits+(r.last?64:0)+(r.mode===d?128:0)+(20===r.mode||15===r.mode?256:0),(0===k&&0===S||4===e)&&D===f&&(D=-5),D)},e.inflateEnd=function(t){if(!t||!t.state)return u;var e=t.state;return e.window&&(e.window=null),t.state=null,f},e.inflateGetHeader=function(t,e){var r;return t&&t.state?0==(2&(r=t.state).wrap)?u:(r.head=e,e.done=!1,f):u},e.inflateSetDictionary=function(t,e){var r,i=e.length;return t&&t.state?0!==(r=t.state).wrap&&11!==r.mode?u:11===r.mode&&n(1,e,i,0)!==r.check?-3:A(t,e,i,i)?(r.mode=31,-4):(r.havedict=1,f):u},e.inflateInfo="pako inflate (from Nodeca project)"},881:(t,e,r)=>{"use strict";var i=r(9761),n=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],a=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],o=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],s=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];t.exports=function(t,e,r,h,l,f,u,c){var d,p,m,g,b,_,y,w,v,x=c.bits,E=0,k=0,S=0,M=0,A=0,I=0,B=0,T=0,R=0,P=0,O=null,L=0,C=new i.Buf16(16),U=new i.Buf16(16),z=null,D=0;for(E=0;E<=15;E++)C[E]=0;for(k=0;k<h;k++)C[e[r+k]]++;for(A=x,M=15;M>=1&&0===C[M];M--);if(A>M&&(A=M),0===M)return l[f++]=20971520,l[f++]=20971520,c.bits=1,0;for(S=1;S<M&&0===C[S];S++);for(A<S&&(A=S),T=1,E=1;E<=15;E++)if(T<<=1,(T-=C[E])<0)return-1;if(T>0&&(0===t||1!==M))return-1;for(U[1]=0,E=1;E<15;E++)U[E+1]=U[E]+C[E];for(k=0;k<h;k++)0!==e[r+k]&&(u[U[e[r+k]]++]=k);if(0===t?(O=z=u,_=19):1===t?(O=n,L-=257,z=a,D-=257,_=256):(O=o,z=s,_=-1),P=0,k=0,E=S,b=f,I=A,B=0,m=-1,g=(R=1<<A)-1,1===t&&R>852||2===t&&R>592)return 1;for(;;){y=E-B,u[k]<_?(w=0,v=u[k]):u[k]>_?(w=z[D+u[k]],v=O[L+u[k]]):(w=96,v=0),d=1<<E-B,S=p=1<<I;do{l[b+(P>>B)+(p-=d)]=y<<24|w<<16|v|0}while(0!==p);for(d=1<<E-1;P&d;)d>>=1;if(0!==d?(P&=d-1,P+=d):P=0,k++,0==--C[E]){if(E===M)break;E=e[r+u[k]]}if(E>A&&(P&g)!==m){for(0===B&&(B=A),b+=S,T=1<<(I=E-B);I+B<M&&!((T-=C[I+B])<=0);)I++,T<<=1;if(R+=1<<I,1===t&&R>852||2===t&&R>592)return 1;l[m=P&g]=A<<24|I<<16|b-f|0}}return 0!==P&&(l[b+P]=E-B<<24|64<<16|0),c.bits=A,0}},2950:t=>{"use strict";t.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"}},9564:(t,e,r)=>{"use strict";var i=r(9761);function n(t){for(var e=t.length;--e>=0;)t[e]=0}var a=0,o=256,s=o+1+29,h=30,l=19,f=2*s+1,u=15,c=16,d=256,p=16,m=17,g=18,b=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],_=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],y=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],w=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],v=new Array(2*(s+2));n(v);var x=new Array(2*h);n(x);var E=new Array(512);n(E);var k=new Array(256);n(k);var S=new Array(29);n(S);var M,A,I,B=new Array(h);function T(t,e,r,i,n){this.static_tree=t,this.extra_bits=e,this.extra_base=r,this.elems=i,this.max_length=n,this.has_stree=t&&t.length}function R(t,e){this.dyn_tree=t,this.max_code=0,this.stat_desc=e}function P(t){return t<256?E[t]:E[256+(t>>>7)]}function O(t,e){t.pending_buf[t.pending++]=255&e,t.pending_buf[t.pending++]=e>>>8&255}function L(t,e,r){t.bi_valid>c-r?(t.bi_buf|=e<<t.bi_valid&65535,O(t,t.bi_buf),t.bi_buf=e>>c-t.bi_valid,t.bi_valid+=r-c):(t.bi_buf|=e<<t.bi_valid&65535,t.bi_valid+=r)}function C(t,e,r){L(t,r[2*e],r[2*e+1])}function U(t,e){var r=0;do{r|=1&t,t>>>=1,r<<=1}while(--e>0);return r>>>1}function z(t,e,r){var i,n,a=new Array(u+1),o=0;for(i=1;i<=u;i++)a[i]=o=o+r[i-1]<<1;for(n=0;n<=e;n++){var s=t[2*n+1];0!==s&&(t[2*n]=U(a[s]++,s))}}function D(t){var e;for(e=0;e<s;e++)t.dyn_ltree[2*e]=0;for(e=0;e<h;e++)t.dyn_dtree[2*e]=0;for(e=0;e<l;e++)t.bl_tree[2*e]=0;t.dyn_ltree[2*d]=1,t.opt_len=t.static_len=0,t.last_lit=t.matches=0}function N(t){t.bi_valid>8?O(t,t.bi_buf):t.bi_valid>0&&(t.pending_buf[t.pending++]=t.bi_buf),t.bi_buf=0,t.bi_valid=0}function F(t,e,r,i){var n=2*e,a=2*r;return t[n]<t[a]||t[n]===t[a]&&i[e]<=i[r]}function j(t,e,r){for(var i=t.heap[r],n=r<<1;n<=t.heap_len&&(n<t.heap_len&&F(e,t.heap[n+1],t.heap[n],t.depth)&&n++,!F(e,i,t.heap[n],t.depth));)t.heap[r]=t.heap[n],r=n,n<<=1;t.heap[r]=i}function G(t,e,r){var i,n,a,s,h=0;if(0!==t.last_lit)do{i=t.pending_buf[t.d_buf+2*h]<<8|t.pending_buf[t.d_buf+2*h+1],n=t.pending_buf[t.l_buf+h],h++,0===i?C(t,n,e):(C(t,(a=k[n])+o+1,e),0!==(s=b[a])&&L(t,n-=S[a],s),C(t,a=P(--i),r),0!==(s=_[a])&&L(t,i-=B[a],s))}while(h<t.last_lit);C(t,d,e)}function H(t,e){var r,i,n,a=e.dyn_tree,o=e.stat_desc.static_tree,s=e.stat_desc.has_stree,h=e.stat_desc.elems,l=-1;for(t.heap_len=0,t.heap_max=f,r=0;r<h;r++)0!==a[2*r]?(t.heap[++t.heap_len]=l=r,t.depth[r]=0):a[2*r+1]=0;for(;t.heap_len<2;)a[2*(n=t.heap[++t.heap_len]=l<2?++l:0)]=1,t.depth[n]=0,t.opt_len--,s&&(t.static_len-=o[2*n+1]);for(e.max_code=l,r=t.heap_len>>1;r>=1;r--)j(t,a,r);n=h;do{r=t.heap[1],t.heap[1]=t.heap[t.heap_len--],j(t,a,1),i=t.heap[1],t.heap[--t.heap_max]=r,t.heap[--t.heap_max]=i,a[2*n]=a[2*r]+a[2*i],t.depth[n]=(t.depth[r]>=t.depth[i]?t.depth[r]:t.depth[i])+1,a[2*r+1]=a[2*i+1]=n,t.heap[1]=n++,j(t,a,1)}while(t.heap_len>=2);t.heap[--t.heap_max]=t.heap[1],function(t,e){var r,i,n,a,o,s,h=e.dyn_tree,l=e.max_code,c=e.stat_desc.static_tree,d=e.stat_desc.has_stree,p=e.stat_desc.extra_bits,m=e.stat_desc.extra_base,g=e.stat_desc.max_length,b=0;for(a=0;a<=u;a++)t.bl_count[a]=0;for(h[2*t.heap[t.heap_max]+1]=0,r=t.heap_max+1;r<f;r++)(a=h[2*h[2*(i=t.heap[r])+1]+1]+1)>g&&(a=g,b++),h[2*i+1]=a,i>l||(t.bl_count[a]++,o=0,i>=m&&(o=p[i-m]),s=h[2*i],t.opt_len+=s*(a+o),d&&(t.static_len+=s*(c[2*i+1]+o)));if(0!==b){do{for(a=g-1;0===t.bl_count[a];)a--;t.bl_count[a]--,t.bl_count[a+1]+=2,t.bl_count[g]--,b-=2}while(b>0);for(a=g;0!==a;a--)for(i=t.bl_count[a];0!==i;)(n=t.heap[--r])>l||(h[2*n+1]!==a&&(t.opt_len+=(a-h[2*n+1])*h[2*n],h[2*n+1]=a),i--)}}(t,e),z(a,l,t.bl_count)}function W(t,e,r){var i,n,a=-1,o=e[1],s=0,h=7,l=4;for(0===o&&(h=138,l=3),e[2*(r+1)+1]=65535,i=0;i<=r;i++)n=o,o=e[2*(i+1)+1],++s<h&&n===o||(s<l?t.bl_tree[2*n]+=s:0!==n?(n!==a&&t.bl_tree[2*n]++,t.bl_tree[2*p]++):s<=10?t.bl_tree[2*m]++:t.bl_tree[2*g]++,s=0,a=n,0===o?(h=138,l=3):n===o?(h=6,l=3):(h=7,l=4))}function q(t,e,r){var i,n,a=-1,o=e[1],s=0,h=7,l=4;for(0===o&&(h=138,l=3),i=0;i<=r;i++)if(n=o,o=e[2*(i+1)+1],!(++s<h&&n===o)){if(s<l)do{C(t,n,t.bl_tree)}while(0!=--s);else 0!==n?(n!==a&&(C(t,n,t.bl_tree),s--),C(t,p,t.bl_tree),L(t,s-3,2)):s<=10?(C(t,m,t.bl_tree),L(t,s-3,3)):(C(t,g,t.bl_tree),L(t,s-11,7));s=0,a=n,0===o?(h=138,l=3):n===o?(h=6,l=3):(h=7,l=4)}}n(B);var Z=!1;function Y(t,e,r,n){L(t,(a<<1)+(n?1:0),3),function(t,e,r,n){N(t),O(t,r),O(t,~r),i.arraySet(t.pending_buf,t.window,e,r,t.pending),t.pending+=r}(t,e,r)}e._tr_init=function(t){Z||(function(){var t,e,r,i,n,a=new Array(u+1);for(r=0,i=0;i<28;i++)for(S[i]=r,t=0;t<1<<b[i];t++)k[r++]=i;for(k[r-1]=i,n=0,i=0;i<16;i++)for(B[i]=n,t=0;t<1<<_[i];t++)E[n++]=i;for(n>>=7;i<h;i++)for(B[i]=n<<7,t=0;t<1<<_[i]-7;t++)E[256+n++]=i;for(e=0;e<=u;e++)a[e]=0;for(t=0;t<=143;)v[2*t+1]=8,t++,a[8]++;for(;t<=255;)v[2*t+1]=9,t++,a[9]++;for(;t<=279;)v[2*t+1]=7,t++,a[7]++;for(;t<=287;)v[2*t+1]=8,t++,a[8]++;for(z(v,s+1,a),t=0;t<h;t++)x[2*t+1]=5,x[2*t]=U(t,5);M=new T(v,b,o+1,s,u),A=new T(x,_,0,h,u),I=new T(new Array(0),y,0,l,7)}(),Z=!0),t.l_desc=new R(t.dyn_ltree,M),t.d_desc=new R(t.dyn_dtree,A),t.bl_desc=new R(t.bl_tree,I),t.bi_buf=0,t.bi_valid=0,D(t)},e._tr_stored_block=Y,e._tr_flush_block=function(t,e,r,i){var n,a,s=0;t.level>0?(2===t.strm.data_type&&(t.strm.data_type=function(t){var e,r=4093624447;for(e=0;e<=31;e++,r>>>=1)if(1&r&&0!==t.dyn_ltree[2*e])return 0;if(0!==t.dyn_ltree[18]||0!==t.dyn_ltree[20]||0!==t.dyn_ltree[26])return 1;for(e=32;e<o;e++)if(0!==t.dyn_ltree[2*e])return 1;return 0}(t)),H(t,t.l_desc),H(t,t.d_desc),s=function(t){var e;for(W(t,t.dyn_ltree,t.l_desc.max_code),W(t,t.dyn_dtree,t.d_desc.max_code),H(t,t.bl_desc),e=l-1;e>=3&&0===t.bl_tree[2*w[e]+1];e--);return t.opt_len+=3*(e+1)+5+5+4,e}(t),n=t.opt_len+3+7>>>3,(a=t.static_len+3+7>>>3)<=n&&(n=a)):n=a=r+5,r+4<=n&&-1!==e?Y(t,e,r,i):4===t.strategy||a===n?(L(t,2+(i?1:0),3),G(t,v,x)):(L(t,4+(i?1:0),3),function(t,e,r,i){var n;for(L(t,e-257,5),L(t,r-1,5),L(t,i-4,4),n=0;n<i;n++)L(t,t.bl_tree[2*w[n]+1],3);q(t,t.dyn_ltree,e-1),q(t,t.dyn_dtree,r-1)}(t,t.l_desc.max_code+1,t.d_desc.max_code+1,s+1),G(t,t.dyn_ltree,t.dyn_dtree)),D(t),i&&N(t)},e._tr_tally=function(t,e,r){return t.pending_buf[t.d_buf+2*t.last_lit]=e>>>8&255,t.pending_buf[t.d_buf+2*t.last_lit+1]=255&e,t.pending_buf[t.l_buf+t.last_lit]=255&r,t.last_lit++,0===e?t.dyn_ltree[2*r]++:(t.matches++,e--,t.dyn_ltree[2*(k[r]+o+1)]++,t.dyn_dtree[2*P(e)]++),t.last_lit===t.lit_bufsize-1},e._tr_align=function(t){L(t,2,3),C(t,d,v),function(t){16===t.bi_valid?(O(t,t.bi_buf),t.bi_buf=0,t.bi_valid=0):t.bi_valid>=8&&(t.pending_buf[t.pending++]=255&t.bi_buf,t.bi_buf>>=8,t.bi_valid-=8)}(t)}},744:t=>{"use strict";t.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0}},4398:t=>{function e(t,e){if(!(t=t.replace(/\t+/g," ").trim()))return null;var i=t.indexOf(" ");if(-1===i)throw new Error("no named row at line "+e);var n=t.substring(0,i);t=(t=(t=(t=t.substring(i+1)).replace(/letter=[\'\"]\S+[\'\"]/gi,"")).split("=")).map((function(t){return t.trim().match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g)}));for(var a=[],o=0;o<t.length;o++){var s=t[o];0===o?a.push({key:s[0],data:""}):o===t.length-1?a[a.length-1].data=r(s[0]):(a[a.length-1].data=r(s[0]),a.push({key:s[1],data:""}))}var h={key:n,data:{}};return a.forEach((function(t){h.data[t.key]=t.data})),h}function r(t){return t&&0!==t.length?0===t.indexOf('"')||0===t.indexOf("'")?t.substring(1,t.length-1):-1!==t.indexOf(",")?function(t){return t.split(",").map((function(t){return parseInt(t,10)}))}(t):parseInt(t,10):""}t.exports=function(t){if(!t)throw new Error("no data provided");var r={pages:[],chars:[],kernings:[]},i=(t=t.toString().trim()).split(/\r\n?|\n/g);if(0===i.length)throw new Error("no data in BMFont file");for(var n=0;n<i.length;n++){var a=e(i[n],n);if(a)if("page"===a.key){if("number"!=typeof a.data.id)throw new Error("malformed file at line "+n+" -- needs page id=N");if("string"!=typeof a.data.file)throw new Error("malformed file at line "+n+' -- needs page file="path"');r.pages[a.data.id]=a.data.file}else"chars"===a.key||"kernings"===a.key||("char"===a.key?r.chars.push(a.data):"kerning"===a.key?r.kernings.push(a.data):r[a.key]=a.data)}return r}},8438:t=>{var e=[66,77,70];function r(t,e,r){if(r>e.length-1)return 0;var n=e.readUInt8(r++),a=e.readInt32LE(r);switch(r+=4,n){case 1:t.info=function(t,e){var r={};r.size=t.readInt16LE(e);var n=t.readUInt8(e+2);return r.smooth=n>>7&1,r.unicode=n>>6&1,r.italic=n>>5&1,r.bold=n>>4&1,n>>3&1&&(r.fixedHeight=1),r.charset=t.readUInt8(e+3)||"",r.stretchH=t.readUInt16LE(e+4),r.aa=t.readUInt8(e+6),r.padding=[t.readInt8(e+7),t.readInt8(e+8),t.readInt8(e+9),t.readInt8(e+10)],r.spacing=[t.readInt8(e+11),t.readInt8(e+12)],r.outline=t.readUInt8(e+13),r.face=function(t,e){return i(t,e).toString("utf8")}(t,e+14),r}(e,r);break;case 2:t.common=function(t,e){var r={};return r.lineHeight=t.readUInt16LE(e),r.base=t.readUInt16LE(e+2),r.scaleW=t.readUInt16LE(e+4),r.scaleH=t.readUInt16LE(e+6),r.pages=t.readUInt16LE(e+8),t.readUInt8(e+10),r.packed=0,r.alphaChnl=t.readUInt8(e+11),r.redChnl=t.readUInt8(e+12),r.greenChnl=t.readUInt8(e+13),r.blueChnl=t.readUInt8(e+14),r}(e,r);break;case 3:t.pages=function(t,e,r){for(var n=[],a=i(t,e),o=a.length+1,s=r/o,h=0;h<s;h++)n[h]=t.slice(e,e+a.length).toString("utf8"),e+=o;return n}(e,r,a);break;case 4:t.chars=function(t,e,r){for(var i=[],n=r/20,a=0;a<n;a++){var o={},s=20*a;o.id=t.readUInt32LE(e+0+s),o.x=t.readUInt16LE(e+4+s),o.y=t.readUInt16LE(e+6+s),o.width=t.readUInt16LE(e+8+s),o.height=t.readUInt16LE(e+10+s),o.xoffset=t.readInt16LE(e+12+s),o.yoffset=t.readInt16LE(e+14+s),o.xadvance=t.readInt16LE(e+16+s),o.page=t.readUInt8(e+18+s),o.chnl=t.readUInt8(e+19+s),i[a]=o}return i}(e,r,a);break;case 5:t.kernings=function(t,e,r){for(var i=[],n=r/10,a=0;a<n;a++){var o={},s=10*a;o.first=t.readUInt32LE(e+0+s),o.second=t.readUInt32LE(e+4+s),o.amount=t.readInt16LE(e+8+s),i[a]=o}return i}(e,r,a)}return 5+a}function i(t,e){for(var r=e;r<t.length&&0!==t[r];r++);return t.slice(e,r)}t.exports=function(t){if(t.length<6)throw new Error("invalid buffer length for BMFont");var i=e.every((function(e,r){return t.readUInt8(r)===e}));if(!i)throw new Error("BMFont missing BMF byte header");var n=3;if(t.readUInt8(n++)>3)throw new Error("Only supports BMFont Binary v3 (BMFont App v1.10)");for(var a={kernings:[],chars:[]},o=0;o<5;o++)n+=r(a,t,n);return a}},5947:(t,e,r)=>{var i=r(403),n=r(1596),a={scaleh:"scaleH",scalew:"scaleW",stretchh:"stretchH",lineheight:"lineHeight",alphachnl:"alphaChnl",redchnl:"redChnl",greenchnl:"greenChnl",bluechnl:"blueChnl"};function o(t){var e=function(t){for(var e=[],r=0;r<t.attributes.length;r++)e.push(t.attributes[r]);return e}(t);return e.reduce((function(t,e){var r;return t[(r=e.nodeName,a[r.toLowerCase()]||r)]=e.nodeValue,t}),{})}t.exports=function(t){t=t.toString();var e=n(t),r={pages:[],chars:[],kernings:[]};["info","common"].forEach((function(t){var n=e.getElementsByTagName(t)[0];n&&(r[t]=i(o(n)))}));var a=e.getElementsByTagName("pages")[0];if(!a)throw new Error("malformed file -- no <pages> element");for(var s=a.getElementsByTagName("page"),h=0;h<s.length;h++){var l=s[h],f=parseInt(l.getAttribute("id"),10),u=l.getAttribute("file");if(isNaN(f))throw new Error('malformed file -- page "id" attribute is NaN');if(!u)throw new Error('malformed file -- needs page "file" attribute');r.pages[parseInt(f,10)]=u}return["chars","kernings"].forEach((function(t){var n=e.getElementsByTagName(t)[0];if(n)for(var a=t.substring(0,t.length-1),s=n.getElementsByTagName(a),h=0;h<s.length;h++){var l=s[h];r[t].push(i(o(l)))}})),r}},403:t=>{var e="chasrset";t.exports=function(t){for(var r in e in t&&(t.charset=t[e],delete t[e]),t)"face"!==r&&"charset"!==r&&(t[r]="padding"===r||"spacing"===r?t[r].split(",").map((function(t){return parseInt(t,10)})):parseInt(t[r],10));return t}},4655:(t,e,r)=>{var i=r(311),n=r(3243);t.exports=function(t){if(!t)return{};var e={};return n(i(t).split("\n"),(function(t){var r,n=t.indexOf(":"),a=i(t.slice(0,n)).toLowerCase(),o=i(t.slice(n+1));void 0===e[a]?e[a]=o:(r=e[a],"[object Array]"===Object.prototype.toString.call(r)?e[a].push(o):e[a]=[e[a],o])})),e}},1023:(t,e,r)=>{"use strict";var i=r(4406);function n(t){if("string"!=typeof t)throw new TypeError("Path must be a string. Received "+JSON.stringify(t))}function a(t,e){for(var r,i="",n=0,a=-1,o=0,s=0;s<=t.length;++s){if(s<t.length)r=t.charCodeAt(s);else{if(47===r)break;r=47}if(47===r){if(a===s-1||1===o);else if(a!==s-1&&2===o){if(i.length<2||2!==n||46!==i.charCodeAt(i.length-1)||46!==i.charCodeAt(i.length-2))if(i.length>2){var h=i.lastIndexOf("/");if(h!==i.length-1){-1===h?(i="",n=0):n=(i=i.slice(0,h)).length-1-i.lastIndexOf("/"),a=s,o=0;continue}}else if(2===i.length||1===i.length){i="",n=0,a=s,o=0;continue}e&&(i.length>0?i+="/..":i="..",n=2)}else i.length>0?i+="/"+t.slice(a+1,s):i=t.slice(a+1,s),n=s-a-1;a=s,o=0}else 46===r&&-1!==o?++o:o=-1}return i}var o={resolve:function(){for(var t,e="",r=!1,o=arguments.length-1;o>=-1&&!r;o--){var s;o>=0?s=arguments[o]:(void 0===t&&(t=i.cwd()),s=t),n(s),0!==s.length&&(e=s+"/"+e,r=47===s.charCodeAt(0))}return e=a(e,!r),r?e.length>0?"/"+e:"/":e.length>0?e:"."},normalize:function(t){if(n(t),0===t.length)return".";var e=47===t.charCodeAt(0),r=47===t.charCodeAt(t.length-1);return 0!==(t=a(t,!e)).length||e||(t="."),t.length>0&&r&&(t+="/"),e?"/"+t:t},isAbsolute:function(t){return n(t),t.length>0&&47===t.charCodeAt(0)},join:function(){if(0===arguments.length)return".";for(var t,e=0;e<arguments.length;++e){var r=arguments[e];n(r),r.length>0&&(void 0===t?t=r:t+="/"+r)}return void 0===t?".":o.normalize(t)},relative:function(t,e){if(n(t),n(e),t===e)return"";if((t=o.resolve(t))===(e=o.resolve(e)))return"";for(var r=1;r<t.length&&47===t.charCodeAt(r);++r);for(var i=t.length,a=i-r,s=1;s<e.length&&47===e.charCodeAt(s);++s);for(var h=e.length-s,l=a<h?a:h,f=-1,u=0;u<=l;++u){if(u===l){if(h>l){if(47===e.charCodeAt(s+u))return e.slice(s+u+1);if(0===u)return e.slice(s+u)}else a>l&&(47===t.charCodeAt(r+u)?f=u:0===u&&(f=0));break}var c=t.charCodeAt(r+u);if(c!==e.charCodeAt(s+u))break;47===c&&(f=u)}var d="";for(u=r+f+1;u<=i;++u)u!==i&&47!==t.charCodeAt(u)||(0===d.length?d+="..":d+="/..");return d.length>0?d+e.slice(s+f):(s+=f,47===e.charCodeAt(s)&&++s,e.slice(s))},_makeLong:function(t){return t},dirname:function(t){if(n(t),0===t.length)return".";for(var e=t.charCodeAt(0),r=47===e,i=-1,a=!0,o=t.length-1;o>=1;--o)if(47===(e=t.charCodeAt(o))){if(!a){i=o;break}}else a=!1;return-1===i?r?"/":".":r&&1===i?"//":t.slice(0,i)},basename:function(t,e){if(void 0!==e&&"string"!=typeof e)throw new TypeError('"ext" argument must be a string');n(t);var r,i=0,a=-1,o=!0;if(void 0!==e&&e.length>0&&e.length<=t.length){if(e.length===t.length&&e===t)return"";var s=e.length-1,h=-1;for(r=t.length-1;r>=0;--r){var l=t.charCodeAt(r);if(47===l){if(!o){i=r+1;break}}else-1===h&&(o=!1,h=r+1),s>=0&&(l===e.charCodeAt(s)?-1==--s&&(a=r):(s=-1,a=h))}return i===a?a=h:-1===a&&(a=t.length),t.slice(i,a)}for(r=t.length-1;r>=0;--r)if(47===t.charCodeAt(r)){if(!o){i=r+1;break}}else-1===a&&(o=!1,a=r+1);return-1===a?"":t.slice(i,a)},extname:function(t){n(t);for(var e=-1,r=0,i=-1,a=!0,o=0,s=t.length-1;s>=0;--s){var h=t.charCodeAt(s);if(47!==h)-1===i&&(a=!1,i=s+1),46===h?-1===e?e=s:1!==o&&(o=1):-1!==e&&(o=-1);else if(!a){r=s+1;break}}return-1===e||-1===i||0===o||1===o&&e===i-1&&e===r+1?"":t.slice(e,i)},format:function(t){if(null===t||"object"!=typeof t)throw new TypeError('The "pathObject" argument must be of type Object. Received type '+typeof t);return function(t,e){var r=e.dir||e.root,i=e.base||(e.name||"")+(e.ext||"");return r?r===e.root?r+i:r+"/"+i:i}(0,t)},parse:function(t){n(t);var e={root:"",dir:"",base:"",ext:"",name:""};if(0===t.length)return e;var r,i=t.charCodeAt(0),a=47===i;a?(e.root="/",r=1):r=0;for(var o=-1,s=0,h=-1,l=!0,f=t.length-1,u=0;f>=r;--f)if(47!==(i=t.charCodeAt(f)))-1===h&&(l=!1,h=f+1),46===i?-1===o?o=f:1!==u&&(u=1):-1!==o&&(u=-1);else if(!l){s=f+1;break}return-1===o||-1===h||0===u||1===u&&o===h-1&&o===s+1?-1!==h&&(e.base=e.name=0===s&&a?t.slice(1,h):t.slice(s,h)):(0===s&&a?(e.name=t.slice(1,o),e.base=t.slice(1,h)):(e.name=t.slice(s,o),e.base=t.slice(s,h)),e.ext=t.slice(o,h)),s>0?e.dir=t.slice(0,s-1):a&&(e.dir="/"),e},sep:"/",delimiter:":",win32:null,posix:null};o.posix=o,t.exports=o},482:(t,e)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.Deferred=void 0,e.Deferred=class{constructor(){this.resolve=()=>null,this.reject=()=>null,this.promise=new Promise(((t,e)=>{this.reject=e,this.resolve=t}))}}},5567:(t,e)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.EndOfStreamError=e.defaultMessages=void 0,e.defaultMessages="End-Of-Stream";class r extends Error{constructor(){super(e.defaultMessages)}}e.EndOfStreamError=r},4514:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.StreamReader=e.EndOfStreamError=void 0;const i=r(5567),n=r(482);var a=r(5567);Object.defineProperty(e,"EndOfStreamError",{enumerable:!0,get:function(){return a.EndOfStreamError}}),e.StreamReader=class{constructor(t){if(this.s=t,this.deferred=null,this.endOfStream=!1,this.peekQueue=[],!t.read||!t.once)throw new Error("Expected an instance of stream.Readable");this.s.once("end",(()=>this.reject(new i.EndOfStreamError))),this.s.once("error",(t=>this.reject(t))),this.s.once("close",(()=>this.reject(new Error("Stream closed"))))}async peek(t,e,r){const i=await this.read(t,e,r);return this.peekQueue.push(t.subarray(e,e+i)),i}async read(t,e,r){if(0===r)return 0;if(0===this.peekQueue.length&&this.endOfStream)throw new i.EndOfStreamError;let n=r,a=0;for(;this.peekQueue.length>0&&n>0;){const r=this.peekQueue.pop();if(!r)throw new Error("peekData should be defined");const i=Math.min(r.length,n);t.set(r.subarray(0,i),e+a),a+=i,n-=i,i<r.length&&this.peekQueue.push(r.subarray(i))}for(;n>0&&!this.endOfStream;){const r=Math.min(n,1048576),i=await this.readFromStream(t,e+a,r);if(a+=i,i<r)break;n-=i}return a}async readFromStream(t,e,r){const i=this.s.read(r);if(i)return t.set(i,e),i.length;{const i={buffer:t,offset:e,length:r,deferred:new n.Deferred};return this.deferred=i.deferred,this.s.once("readable",(()=>{this.readDeferred(i)})),i.deferred.promise}}readDeferred(t){const e=this.s.read(t.length);e?(t.buffer.set(e,t.offset),t.deferred.resolve(e.length),this.deferred=null):this.s.once("readable",(()=>{this.readDeferred(t)}))}reject(t){this.endOfStream=!0,this.deferred&&(this.deferred.reject(t),this.deferred=null)}}},4644:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.StreamReader=e.EndOfStreamError=void 0;var i=r(5567);Object.defineProperty(e,"EndOfStreamError",{enumerable:!0,get:function(){return i.EndOfStreamError}});var n=r(4514);Object.defineProperty(e,"StreamReader",{enumerable:!0,get:function(){return n.StreamReader}})},1294:t=>{"use strict";function e(t,i,n,a,o,s){for(var h,l,f,u,c=Math.max(i-1,0),d=Math.max(n-1,0),p=Math.min(i+1,a-1),m=Math.min(n+1,o-1),g=4*(n*a+i),b=0,_=0,y=0,w=0,v=0,x=c;x<=p;x++)for(var E=d;E<=m;E++)if(x!==i||E!==n){var k=r(t,t,g,4*(E*a+x),!0);if(0===k?b++:k<0?y++:k>0&&_++,b>2)return!1;s&&(k<w&&(w=k,h=x,l=E),k>v&&(v=k,f=x,u=E))}return!s||0!==y&&0!==_&&(!e(t,h,l,a,o)&&!e(s,h,l,a,o)||!e(t,f,u,a,o)&&!e(s,f,u,a,o))}function r(t,e,r,s,h){var l=t[r+3]/255,f=e[s+3]/255,u=o(t[r+0],l),c=o(t[r+1],l),d=o(t[r+2],l),p=o(e[s+0],f),m=o(e[s+1],f),g=o(e[s+2],f),b=i(u,c,d)-i(p,m,g);if(h)return b;var _=n(u,c,d)-n(p,m,g),y=a(u,c,d)-a(p,m,g);return.5053*b*b+.299*_*_+.1957*y*y}function i(t,e,r){return.29889531*t+.58662247*e+.11448223*r}function n(t,e,r){return.59597799*t-.2741761*e-.32180189*r}function a(t,e,r){return.21147017*t-.52261711*e+.31114694*r}function o(t,e){return 255+(t-255)*e}function s(t,e,r,i,n){t[e+0]=r,t[e+1]=i,t[e+2]=n,t[e+3]=255}t.exports=function(t,n,a,h,l,f){f||(f={});for(var u=void 0===f.threshold?.1:f.threshold,c=35215*u*u,d=0,p=0;p<l;p++)for(var m=0;m<h;m++){var g=4*(p*h+m);if(r(t,n,g,g)>c)f.includeAA||!e(t,m,p,h,l,n)&&!e(n,m,p,h,l,t)?(a&&s(a,g,255,0,0),d++):a&&s(a,g,255,255,0);else if(a){var b=o((void 0,void 0,void 0,void 0,w=(_=t)[(y=g)+3]/255,i(o(_[y+0],w),o(_[y+1],w),o(_[y+2],w))),.1);s(a,g,b,b,b)}}var _,y,w;return d}},9902:(t,e,r)=>{t.exports=function t(e,r,i){function n(o,s){if(!r[o]){if(!e[o]){if(a)return a(o,!0);var h=new Error("Cannot find module '"+o+"'");throw h.code="MODULE_NOT_FOUND",h}var l=r[o]={exports:{}};e[o][0].call(l.exports,(function(t){return n(e[o][1][t]||t)}),l,l.exports,t,e,r,i)}return r[o].exports}for(var a=void 0,o=0;o<i.length;o++)n(i[o]);return n}({1:[function(t,e,r){(function(e){(function(){"use strict";let i=t("./interlace"),n=[function(){},function(t,e,r,i){if(i===e.length)throw new Error("Ran out of data");let n=e[i];t[r]=n,t[r+1]=n,t[r+2]=n,t[r+3]=255},function(t,e,r,i){if(i+1>=e.length)throw new Error("Ran out of data");let n=e[i];t[r]=n,t[r+1]=n,t[r+2]=n,t[r+3]=e[i+1]},function(t,e,r,i){if(i+2>=e.length)throw new Error("Ran out of data");t[r]=e[i],t[r+1]=e[i+1],t[r+2]=e[i+2],t[r+3]=255},function(t,e,r,i){if(i+3>=e.length)throw new Error("Ran out of data");t[r]=e[i],t[r+1]=e[i+1],t[r+2]=e[i+2],t[r+3]=e[i+3]}],a=[function(){},function(t,e,r,i){let n=e[0];t[r]=n,t[r+1]=n,t[r+2]=n,t[r+3]=i},function(t,e,r){let i=e[0];t[r]=i,t[r+1]=i,t[r+2]=i,t[r+3]=e[1]},function(t,e,r,i){t[r]=e[0],t[r+1]=e[1],t[r+2]=e[2],t[r+3]=i},function(t,e,r){t[r]=e[0],t[r+1]=e[1],t[r+2]=e[2],t[r+3]=e[3]}];function o(t,e,r,i,a,o){let s=t.width,h=t.height,l=t.index;for(let t=0;t<h;t++)for(let h=0;h<s;h++){let s=r(h,t,l);n[i](e,a,s,o),o+=i}return o}function s(t,e,r,i,n,o){let s=t.width,h=t.height,l=t.index;for(let t=0;t<h;t++){for(let h=0;h<s;h++){let s=n.get(i),f=r(h,t,l);a[i](e,s,f,o)}n.resetAfterLine()}}r.dataToBitMap=function(t,r){let n,a,h=r.width,l=r.height,f=r.depth,u=r.bpp,c=r.interlace;8!==f&&(n=function(t,e){let r=[],i=0;function n(){if(i===t.length)throw new Error("Ran out of data");let n,a,o,s,h,l,f,u,c=t[i];switch(i++,e){default:throw new Error("unrecognised depth");case 16:f=t[i],i++,r.push((c<<8)+f);break;case 4:f=15&c,u=c>>4,r.push(u,f);break;case 2:h=3&c,l=c>>2&3,f=c>>4&3,u=c>>6&3,r.push(u,f,l,h);break;case 1:n=1&c,a=c>>1&1,o=c>>2&1,s=c>>3&1,h=c>>4&1,l=c>>5&1,f=c>>6&1,u=c>>7&1,r.push(u,f,l,h,s,o,a,n)}}return{get:function(t){for(;r.length<t;)n();let e=r.slice(0,t);return r=r.slice(t),e},resetAfterLine:function(){r.length=0},end:function(){if(i!==t.length)throw new Error("extra data found")}}}(t,f)),a=f<=8?e.alloc(h*l*4):new Uint16Array(h*l*4);let d,p,m=Math.pow(2,f)-1,g=0;if(c)d=i.getImagePasses(h,l),p=i.getInterlaceIterator(h,l);else{let t=0;p=function(){let e=t;return t+=4,e},d=[{width:h,height:l}]}for(let e=0;e<d.length;e++)8===f?g=o(d[e],a,p,u,t,g):s(d[e],a,p,u,n,m);if(8===f){if(g!==t.length)throw new Error("extra data found")}else n.end();return a}}).call(this)}).call(this,t("buffer").Buffer)},{"./interlace":11,buffer:33}],2:[function(t,e,r){(function(r){(function(){"use strict";let i=t("./constants");e.exports=function(t,e,n,a){let o=-1!==[i.COLORTYPE_COLOR_ALPHA,i.COLORTYPE_ALPHA].indexOf(a.colorType);if(a.colorType===a.inputColorType){let e=function(){let t=new ArrayBuffer(2);return new DataView(t).setInt16(0,256,!0),256!==new Int16Array(t)[0]}();if(8===a.bitDepth||16===a.bitDepth&&e)return t}let s=16!==a.bitDepth?t:new Uint16Array(t.buffer),h=255,l=i.COLORTYPE_TO_BPP_MAP[a.inputColorType];4!==l||a.inputHasAlpha||(l=3);let f=i.COLORTYPE_TO_BPP_MAP[a.colorType];16===a.bitDepth&&(h=65535,f*=2);let u=r.alloc(e*n*f),c=0,d=0,p=a.bgColor||{};function m(){let t,e,r,n=h;switch(a.inputColorType){case i.COLORTYPE_COLOR_ALPHA:n=s[c+3],t=s[c],e=s[c+1],r=s[c+2];break;case i.COLORTYPE_COLOR:t=s[c],e=s[c+1],r=s[c+2];break;case i.COLORTYPE_ALPHA:n=s[c+1],t=s[c],e=t,r=t;break;case i.COLORTYPE_GRAYSCALE:t=s[c],e=t,r=t;break;default:throw new Error("input color type:"+a.inputColorType+" is not supported at present")}return a.inputHasAlpha&&(o||(n/=h,t=Math.min(Math.max(Math.round((1-n)*p.red+n*t),0),h),e=Math.min(Math.max(Math.round((1-n)*p.green+n*e),0),h),r=Math.min(Math.max(Math.round((1-n)*p.blue+n*r),0),h))),{red:t,green:e,blue:r,alpha:n}}void 0===p.red&&(p.red=h),void 0===p.green&&(p.green=h),void 0===p.blue&&(p.blue=h);for(let t=0;t<n;t++)for(let t=0;t<e;t++){let t=m();switch(a.colorType){case i.COLORTYPE_COLOR_ALPHA:case i.COLORTYPE_COLOR:8===a.bitDepth?(u[d]=t.red,u[d+1]=t.green,u[d+2]=t.blue,o&&(u[d+3]=t.alpha)):(u.writeUInt16BE(t.red,d),u.writeUInt16BE(t.green,d+2),u.writeUInt16BE(t.blue,d+4),o&&u.writeUInt16BE(t.alpha,d+6));break;case i.COLORTYPE_ALPHA:case i.COLORTYPE_GRAYSCALE:{let e=(t.red+t.green+t.blue)/3;8===a.bitDepth?(u[d]=e,o&&(u[d+1]=t.alpha)):(u.writeUInt16BE(e,d),o&&u.writeUInt16BE(t.alpha,d+2));break}default:throw new Error("unrecognised color Type "+a.colorType)}c+=l,d+=f}return u}}).call(this)}).call(this,t("buffer").Buffer)},{"./constants":4,buffer:33}],3:[function(t,e,r){(function(r,i){(function(){"use strict";let n=t("util"),a=t("stream"),o=e.exports=function(){a.call(this),this._buffers=[],this._buffered=0,this._reads=[],this._paused=!1,this._encoding="utf8",this.writable=!0};n.inherits(o,a),o.prototype.read=function(t,e){this._reads.push({length:Math.abs(t),allowLess:t<0,func:e}),r.nextTick(function(){this._process(),this._paused&&this._reads&&this._reads.length>0&&(this._paused=!1,this.emit("drain"))}.bind(this))},o.prototype.write=function(t,e){if(!this.writable)return this.emit("error",new Error("Stream not writable")),!1;let r;return r=i.isBuffer(t)?t:i.from(t,e||this._encoding),this._buffers.push(r),this._buffered+=r.length,this._process(),this._reads&&0===this._reads.length&&(this._paused=!0),this.writable&&!this._paused},o.prototype.end=function(t,e){t&&this.write(t,e),this.writable=!1,this._buffers&&(0===this._buffers.length?this._end():(this._buffers.push(null),this._process()))},o.prototype.destroySoon=o.prototype.end,o.prototype._end=function(){this._reads.length>0&&this.emit("error",new Error("Unexpected end of input")),this.destroy()},o.prototype.destroy=function(){this._buffers&&(this.writable=!1,this._reads=null,this._buffers=null,this.emit("close"))},o.prototype._processReadAllowingLess=function(t){this._reads.shift();let e=this._buffers[0];e.length>t.length?(this._buffered-=t.length,this._buffers[0]=e.slice(t.length),t.func.call(this,e.slice(0,t.length))):(this._buffered-=e.length,this._buffers.shift(),t.func.call(this,e))},o.prototype._processRead=function(t){this._reads.shift();let e=0,r=0,n=i.alloc(t.length);for(;e<t.length;){let i=this._buffers[r++],a=Math.min(i.length,t.length-e);i.copy(n,e,0,a),e+=a,a!==i.length&&(this._buffers[--r]=i.slice(a))}r>0&&this._buffers.splice(0,r),this._buffered-=t.length,t.func.call(this,n)},o.prototype._process=function(){try{for(;this._buffered>0&&this._reads&&this._reads.length>0;){let t=this._reads[0];if(t.allowLess)this._processReadAllowingLess(t);else{if(!(this._buffered>=t.length))break;this._processRead(t)}}this._buffers&&!this.writable&&this._end()}catch(t){this.emit("error",t)}}}).call(this)}).call(this,t("_process"),t("buffer").Buffer)},{_process:60,buffer:33,stream:61,util:81}],4:[function(t,e,r){"use strict";e.exports={PNG_SIGNATURE:[137,80,78,71,13,10,26,10],TYPE_IHDR:1229472850,TYPE_IEND:1229278788,TYPE_IDAT:1229209940,TYPE_PLTE:1347179589,TYPE_tRNS:1951551059,TYPE_gAMA:1732332865,COLORTYPE_GRAYSCALE:0,COLORTYPE_PALETTE:1,COLORTYPE_COLOR:2,COLORTYPE_ALPHA:4,COLORTYPE_PALETTE_COLOR:3,COLORTYPE_COLOR_ALPHA:6,COLORTYPE_TO_BPP_MAP:{0:1,2:3,3:1,4:2,6:4},GAMMA_DIVISION:1e5}},{}],5:[function(t,e,r){"use strict";let i=[];!function(){for(let t=0;t<256;t++){let e=t;for(let t=0;t<8;t++)1&e?e=3988292384^e>>>1:e>>>=1;i[t]=e}}();let n=e.exports=function(){this._crc=-1};n.prototype.write=function(t){for(let e=0;e<t.length;e++)this._crc=i[255&(this._crc^t[e])]^this._crc>>>8;return!0},n.prototype.crc32=function(){return-1^this._crc},n.crc32=function(t){let e=-1;for(let r=0;r<t.length;r++)e=i[255&(e^t[r])]^e>>>8;return-1^e}},{}],6:[function(t,e,r){(function(r){(function(){"use strict";let i=t("./paeth-predictor");let n={0:function(t,e,r,i,n){for(let a=0;a<r;a++)i[n+a]=t[e+a]},1:function(t,e,r,i,n,a){for(let o=0;o<r;o++){let r=o>=a?t[e+o-a]:0,s=t[e+o]-r;i[n+o]=s}},2:function(t,e,r,i,n){for(let a=0;a<r;a++){let o=e>0?t[e+a-r]:0,s=t[e+a]-o;i[n+a]=s}},3:function(t,e,r,i,n,a){for(let o=0;o<r;o++){let s=o>=a?t[e+o-a]:0,h=e>0?t[e+o-r]:0,l=t[e+o]-(s+h>>1);i[n+o]=l}},4:function(t,e,r,n,a,o){for(let s=0;s<r;s++){let h=s>=o?t[e+s-o]:0,l=e>0?t[e+s-r]:0,f=e>0&&s>=o?t[e+s-(r+o)]:0,u=t[e+s]-i(h,l,f);n[a+s]=u}}},a={0:function(t,e,r){let i=0,n=e+r;for(let r=e;r<n;r++)i+=Math.abs(t[r]);return i},1:function(t,e,r,i){let n=0;for(let a=0;a<r;a++){let r=a>=i?t[e+a-i]:0,o=t[e+a]-r;n+=Math.abs(o)}return n},2:function(t,e,r){let i=0,n=e+r;for(let a=e;a<n;a++){let n=e>0?t[a-r]:0,o=t[a]-n;i+=Math.abs(o)}return i},3:function(t,e,r,i){let n=0;for(let a=0;a<r;a++){let o=a>=i?t[e+a-i]:0,s=e>0?t[e+a-r]:0,h=t[e+a]-(o+s>>1);n+=Math.abs(h)}return n},4:function(t,e,r,n){let a=0;for(let o=0;o<r;o++){let s=o>=n?t[e+o-n]:0,h=e>0?t[e+o-r]:0,l=e>0&&o>=n?t[e+o-(r+n)]:0,f=t[e+o]-i(s,h,l);a+=Math.abs(f)}return a}};e.exports=function(t,e,i,o,s){let h;if("filterType"in o&&-1!==o.filterType){if("number"!=typeof o.filterType)throw new Error("unrecognised filter types");h=[o.filterType]}else h=[0,1,2,3,4];16===o.bitDepth&&(s*=2);let l=e*s,f=0,u=0,c=r.alloc((l+1)*i),d=h[0];for(let e=0;e<i;e++){if(h.length>1){let e=1/0;for(let r=0;r<h.length;r++){let i=a[h[r]](t,u,l,s);i<e&&(d=h[r],e=i)}}c[f]=d,f++,n[d](t,u,l,c,f,s),f+=l,u+=l}return c}}).call(this)}).call(this,t("buffer").Buffer)},{"./paeth-predictor":15,buffer:33}],7:[function(t,e,r){(function(r){(function(){"use strict";let i=t("util"),n=t("./chunkstream"),a=t("./filter-parse"),o=e.exports=function(t){n.call(this);let e=[],i=this;this._filter=new a(t,{read:this.read.bind(this),write:function(t){e.push(t)},complete:function(){i.emit("complete",r.concat(e))}}),this._filter.start()};i.inherits(o,n)}).call(this)}).call(this,t("buffer").Buffer)},{"./chunkstream":3,"./filter-parse":9,buffer:33,util:81}],8:[function(t,e,r){(function(e){(function(){"use strict";let i=t("./sync-reader"),n=t("./filter-parse");r.process=function(t,r){let a=[],o=new i(t);return new n(r,{read:o.read.bind(o),write:function(t){a.push(t)},complete:function(){}}).start(),o.process(),e.concat(a)}}).call(this)}).call(this,t("buffer").Buffer)},{"./filter-parse":9,"./sync-reader":22,buffer:33}],9:[function(t,e,r){(function(r){(function(){"use strict";let i=t("./interlace"),n=t("./paeth-predictor");function a(t,e,r){let i=t*e;return 8!==r&&(i=Math.ceil(i/(8/r))),i}let o=e.exports=function(t,e){let r=t.width,n=t.height,o=t.interlace,s=t.bpp,h=t.depth;if(this.read=e.read,this.write=e.write,this.complete=e.complete,this._imageIndex=0,this._images=[],o){let t=i.getImagePasses(r,n);for(let e=0;e<t.length;e++)this._images.push({byteWidth:a(t[e].width,s,h),height:t[e].height,lineIndex:0})}else this._images.push({byteWidth:a(r,s,h),height:n,lineIndex:0});this._xComparison=8===h?s:16===h?2*s:1};o.prototype.start=function(){this.read(this._images[this._imageIndex].byteWidth+1,this._reverseFilterLine.bind(this))},o.prototype._unFilterType1=function(t,e,r){let i=this._xComparison,n=i-1;for(let a=0;a<r;a++){let r=t[1+a],o=a>n?e[a-i]:0;e[a]=r+o}},o.prototype._unFilterType2=function(t,e,r){let i=this._lastLine;for(let n=0;n<r;n++){let r=t[1+n],a=i?i[n]:0;e[n]=r+a}},o.prototype._unFilterType3=function(t,e,r){let i=this._xComparison,n=i-1,a=this._lastLine;for(let o=0;o<r;o++){let r=t[1+o],s=a?a[o]:0,h=o>n?e[o-i]:0,l=Math.floor((h+s)/2);e[o]=r+l}},o.prototype._unFilterType4=function(t,e,r){let i=this._xComparison,a=i-1,o=this._lastLine;for(let s=0;s<r;s++){let r=t[1+s],h=o?o[s]:0,l=s>a?e[s-i]:0,f=s>a&&o?o[s-i]:0,u=n(l,h,f);e[s]=r+u}},o.prototype._reverseFilterLine=function(t){let e,i=t[0],n=this._images[this._imageIndex],a=n.byteWidth;if(0===i)e=t.slice(1,a+1);else switch(e=r.alloc(a),i){case 1:this._unFilterType1(t,e,a);break;case 2:this._unFilterType2(t,e,a);break;case 3:this._unFilterType3(t,e,a);break;case 4:this._unFilterType4(t,e,a);break;default:throw new Error("Unrecognised filter type - "+i)}this.write(e),n.lineIndex++,n.lineIndex>=n.height?(this._lastLine=null,this._imageIndex++,n=this._images[this._imageIndex]):this._lastLine=e,n?this.read(n.byteWidth+1,this._reverseFilterLine.bind(this)):(this._lastLine=null,this.complete())}}).call(this)}).call(this,t("buffer").Buffer)},{"./interlace":11,"./paeth-predictor":15,buffer:33}],10:[function(t,e,r){(function(t){(function(){"use strict";e.exports=function(e,r,i=!1){let n=r.depth,a=r.width,o=r.height,s=r.colorType,h=r.transColor,l=r.palette,f=e;return 3===s?function(t,e,r,i,n){let a=0;for(let o=0;o<i;o++)for(let i=0;i<r;i++){let r=n[t[a]];if(!r)throw new Error("index "+t[a]+" not in palette");for(let t=0;t<4;t++)e[a+t]=r[t];a+=4}}(e,f,a,o,l):(h&&function(t,e,r,i,n){let a=0;for(let o=0;o<i;o++)for(let i=0;i<r;i++){let r=!1;if(1===n.length?n[0]===t[a]&&(r=!0):n[0]===t[a]&&n[1]===t[a+1]&&n[2]===t[a+2]&&(r=!0),r)for(let t=0;t<4;t++)e[a+t]=0;a+=4}}(e,f,a,o,h),8===n||i||(16===n&&(f=t.alloc(a*o*4)),function(t,e,r,i,n){let a=Math.pow(2,n)-1,o=0;for(let n=0;n<i;n++)for(let i=0;i<r;i++){for(let r=0;r<4;r++)e[o+r]=Math.floor(255*t[o+r]/a+.5);o+=4}}(e,f,a,o,n))),f}}).call(this)}).call(this,t("buffer").Buffer)},{buffer:33}],11:[function(t,e,r){"use strict";let i=[{x:[0],y:[0]},{x:[4],y:[0]},{x:[0,4],y:[4]},{x:[2,6],y:[0,4]},{x:[0,2,4,6],y:[2,6]},{x:[1,3,5,7],y:[0,2,4,6]},{x:[0,1,2,3,4,5,6,7],y:[1,3,5,7]}];r.getImagePasses=function(t,e){let r=[],n=t%8,a=e%8,o=(t-n)/8,s=(e-a)/8;for(let t=0;t<i.length;t++){let e=i[t],h=o*e.x.length,l=s*e.y.length;for(let t=0;t<e.x.length&&e.x[t]<n;t++)h++;for(let t=0;t<e.y.length&&e.y[t]<a;t++)l++;h>0&&l>0&&r.push({width:h,height:l,index:t})}return r},r.getInterlaceIterator=function(t){return function(e,r,n){let a=e%i[n].x.length,o=(e-a)/i[n].x.length*8+i[n].x[a],s=r%i[n].y.length;return 4*o+((r-s)/i[n].y.length*8+i[n].y[s])*t*4}}},{}],12:[function(t,e,r){(function(r){(function(){"use strict";let i=t("util"),n=t("stream"),a=t("./constants"),o=t("./packer"),s=e.exports=function(t){n.call(this);let e=t||{};this._packer=new o(e),this._deflate=this._packer.createDeflate(),this.readable=!0};i.inherits(s,n),s.prototype.pack=function(t,e,i,n){this.emit("data",r.from(a.PNG_SIGNATURE)),this.emit("data",this._packer.packIHDR(e,i)),n&&this.emit("data",this._packer.packGAMA(n));let o=this._packer.filterData(t,e,i);this._deflate.on("error",this.emit.bind(this,"error")),this._deflate.on("data",function(t){this.emit("data",this._packer.packIDAT(t))}.bind(this)),this._deflate.on("end",function(){this.emit("data",this._packer.packIEND()),this.emit("end")}.bind(this)),this._deflate.end(o)}}).call(this)}).call(this,t("buffer").Buffer)},{"./constants":4,"./packer":14,buffer:33,stream:61,util:81}],13:[function(t,e,r){(function(r){(function(){"use strict";let i=!0,n=t("zlib");n.deflateSync||(i=!1);let a=t("./constants"),o=t("./packer");e.exports=function(t,e){if(!i)throw new Error("To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0");let s=new o(e||{}),h=[];h.push(r.from(a.PNG_SIGNATURE)),h.push(s.packIHDR(t.width,t.height)),t.gamma&&h.push(s.packGAMA(t.gamma));let l=s.filterData(t.data,t.width,t.height),f=n.deflateSync(l,s.getDeflateOptions());if(l=null,!f||!f.length)throw new Error("bad png - invalid compressed data response");return h.push(s.packIDAT(f)),h.push(s.packIEND()),r.concat(h)}}).call(this)}).call(this,t("buffer").Buffer)},{"./constants":4,"./packer":14,buffer:33,zlib:32}],14:[function(t,e,r){(function(r){(function(){"use strict";let i=t("./constants"),n=t("./crc"),a=t("./bitpacker"),o=t("./filter-pack"),s=t("zlib"),h=e.exports=function(t){if(this._options=t,t.deflateChunkSize=t.deflateChunkSize||32768,t.deflateLevel=null!=t.deflateLevel?t.deflateLevel:9,t.deflateStrategy=null!=t.deflateStrategy?t.deflateStrategy:3,t.inputHasAlpha=null==t.inputHasAlpha||t.inputHasAlpha,t.deflateFactory=t.deflateFactory||s.createDeflate,t.bitDepth=t.bitDepth||8,t.colorType="number"==typeof t.colorType?t.colorType:i.COLORTYPE_COLOR_ALPHA,t.inputColorType="number"==typeof t.inputColorType?t.inputColorType:i.COLORTYPE_COLOR_ALPHA,-1===[i.COLORTYPE_GRAYSCALE,i.COLORTYPE_COLOR,i.COLORTYPE_COLOR_ALPHA,i.COLORTYPE_ALPHA].indexOf(t.colorType))throw new Error("option color type:"+t.colorType+" is not supported at present");if(-1===[i.COLORTYPE_GRAYSCALE,i.COLORTYPE_COLOR,i.COLORTYPE_COLOR_ALPHA,i.COLORTYPE_ALPHA].indexOf(t.inputColorType))throw new Error("option input color type:"+t.inputColorType+" is not supported at present");if(8!==t.bitDepth&&16!==t.bitDepth)throw new Error("option bit depth:"+t.bitDepth+" is not supported at present")};h.prototype.getDeflateOptions=function(){return{chunkSize:this._options.deflateChunkSize,level:this._options.deflateLevel,strategy:this._options.deflateStrategy}},h.prototype.createDeflate=function(){return this._options.deflateFactory(this.getDeflateOptions())},h.prototype.filterData=function(t,e,r){let n=a(t,e,r,this._options),s=i.COLORTYPE_TO_BPP_MAP[this._options.colorType];return o(n,e,r,this._options,s)},h.prototype._packChunk=function(t,e){let i=e?e.length:0,a=r.alloc(i+12);return a.writeUInt32BE(i,0),a.writeUInt32BE(t,4),e&&e.copy(a,8),a.writeInt32BE(n.crc32(a.slice(4,a.length-4)),a.length-4),a},h.prototype.packGAMA=function(t){let e=r.alloc(4);return e.writeUInt32BE(Math.floor(t*i.GAMMA_DIVISION),0),this._packChunk(i.TYPE_gAMA,e)},h.prototype.packIHDR=function(t,e){let n=r.alloc(13);return n.writeUInt32BE(t,0),n.writeUInt32BE(e,4),n[8]=this._options.bitDepth,n[9]=this._options.colorType,n[10]=0,n[11]=0,n[12]=0,this._packChunk(i.TYPE_IHDR,n)},h.prototype.packIDAT=function(t){return this._packChunk(i.TYPE_IDAT,t)},h.prototype.packIEND=function(){return this._packChunk(i.TYPE_IEND,null)}}).call(this)}).call(this,t("buffer").Buffer)},{"./bitpacker":2,"./constants":4,"./crc":5,"./filter-pack":6,buffer:33,zlib:32}],15:[function(t,e,r){"use strict";e.exports=function(t,e,r){let i=t+e-r,n=Math.abs(i-t),a=Math.abs(i-e),o=Math.abs(i-r);return n<=a&&n<=o?t:a<=o?e:r}},{}],16:[function(t,e,r){"use strict";let i=t("util"),n=t("zlib"),a=t("./chunkstream"),o=t("./filter-parse-async"),s=t("./parser"),h=t("./bitmapper"),l=t("./format-normaliser"),f=e.exports=function(t){a.call(this),this._parser=new s(t,{read:this.read.bind(this),error:this._handleError.bind(this),metadata:this._handleMetaData.bind(this),gamma:this.emit.bind(this,"gamma"),palette:this._handlePalette.bind(this),transColor:this._handleTransColor.bind(this),finished:this._finished.bind(this),inflateData:this._inflateData.bind(this),simpleTransparency:this._simpleTransparency.bind(this),headersFinished:this._headersFinished.bind(this)}),this._options=t,this.writable=!0,this._parser.start()};i.inherits(f,a),f.prototype._handleError=function(t){this.emit("error",t),this.writable=!1,this.destroy(),this._inflate&&this._inflate.destroy&&this._inflate.destroy(),this._filter&&(this._filter.destroy(),this._filter.on("error",(function(){}))),this.errord=!0},f.prototype._inflateData=function(t){if(!this._inflate)if(this._bitmapInfo.interlace)this._inflate=n.createInflate(),this._inflate.on("error",this.emit.bind(this,"error")),this._filter.on("complete",this._complete.bind(this)),this._inflate.pipe(this._filter);else{let t=(1+(this._bitmapInfo.width*this._bitmapInfo.bpp*this._bitmapInfo.depth+7>>3))*this._bitmapInfo.height,e=Math.max(t,n.Z_MIN_CHUNK);this._inflate=n.createInflate({chunkSize:e});let r=t,i=this.emit.bind(this,"error");this._inflate.on("error",(function(t){r&&i(t)})),this._filter.on("complete",this._complete.bind(this));let a=this._filter.write.bind(this._filter);this._inflate.on("data",(function(t){r&&(t.length>r&&(t=t.slice(0,r)),r-=t.length,a(t))})),this._inflate.on("end",this._filter.end.bind(this._filter))}this._inflate.write(t)},f.prototype._handleMetaData=function(t){this._metaData=t,this._bitmapInfo=Object.create(t),this._filter=new o(this._bitmapInfo)},f.prototype._handleTransColor=function(t){this._bitmapInfo.transColor=t},f.prototype._handlePalette=function(t){this._bitmapInfo.palette=t},f.prototype._simpleTransparency=function(){this._metaData.alpha=!0},f.prototype._headersFinished=function(){this.emit("metadata",this._metaData)},f.prototype._finished=function(){this.errord||(this._inflate?this._inflate.end():this.emit("error","No Inflate block"))},f.prototype._complete=function(t){if(this.errord)return;let e;try{let r=h.dataToBitMap(t,this._bitmapInfo);e=l(r,this._bitmapInfo,this._options.skipRescale),r=null}catch(t){return void this._handleError(t)}this.emit("parsed",e)}},{"./bitmapper":1,"./chunkstream":3,"./filter-parse-async":7,"./format-normaliser":10,"./parser":18,util:81,zlib:32}],17:[function(t,e,r){(function(r){(function(){"use strict";let i=!0,n=t("zlib"),a=t("./sync-inflate");n.deflateSync||(i=!1);let o=t("./sync-reader"),s=t("./filter-parse-sync"),h=t("./parser"),l=t("./bitmapper"),f=t("./format-normaliser");e.exports=function(t,e){if(!i)throw new Error("To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0");let u,c,d;let p=[];let m=new o(t);if(new h(e,{read:m.read.bind(m),error:function(t){u=t},metadata:function(t){c=t},gamma:function(t){d=t},palette:function(t){c.palette=t},transColor:function(t){c.transColor=t},inflateData:function(t){p.push(t)},simpleTransparency:function(){c.alpha=!0}}).start(),m.process(),u)throw u;let g,b=r.concat(p);if(p.length=0,c.interlace)g=n.inflateSync(b);else{let t=(1+(c.width*c.bpp*c.depth+7>>3))*c.height;g=a(b,{chunkSize:t,maxLength:t})}if(b=null,!g||!g.length)throw new Error("bad png - invalid inflate data response");let _=s.process(g,c);b=null;let y=l.dataToBitMap(_,c);_=null;let w=f(y,c,e.skipRescale);return c.data=w,c.gamma=d||0,c}}).call(this)}).call(this,t("buffer").Buffer)},{"./bitmapper":1,"./filter-parse-sync":8,"./format-normaliser":10,"./parser":18,"./sync-inflate":21,"./sync-reader":22,buffer:33,zlib:32}],18:[function(t,e,r){(function(r){(function(){"use strict";let i=t("./constants"),n=t("./crc"),a=e.exports=function(t,e){this._options=t,t.checkCRC=!1!==t.checkCRC,this._hasIHDR=!1,this._hasIEND=!1,this._emittedHeadersFinished=!1,this._palette=[],this._colorType=0,this._chunks={},this._chunks[i.TYPE_IHDR]=this._handleIHDR.bind(this),this._chunks[i.TYPE_IEND]=this._handleIEND.bind(this),this._chunks[i.TYPE_IDAT]=this._handleIDAT.bind(this),this._chunks[i.TYPE_PLTE]=this._handlePLTE.bind(this),this._chunks[i.TYPE_tRNS]=this._handleTRNS.bind(this),this._chunks[i.TYPE_gAMA]=this._handleGAMA.bind(this),this.read=e.read,this.error=e.error,this.metadata=e.metadata,this.gamma=e.gamma,this.transColor=e.transColor,this.palette=e.palette,this.parsed=e.parsed,this.inflateData=e.inflateData,this.finished=e.finished,this.simpleTransparency=e.simpleTransparency,this.headersFinished=e.headersFinished||function(){}};a.prototype.start=function(){this.read(i.PNG_SIGNATURE.length,this._parseSignature.bind(this))},a.prototype._parseSignature=function(t){let e=i.PNG_SIGNATURE;for(let r=0;r<e.length;r++)if(t[r]!==e[r])return void this.error(new Error("Invalid file signature"));this.read(8,this._parseChunkBegin.bind(this))},a.prototype._parseChunkBegin=function(t){let e=t.readUInt32BE(0),a=t.readUInt32BE(4),o="";for(let e=4;e<8;e++)o+=String.fromCharCode(t[e]);let s=Boolean(32&t[4]);if(this._hasIHDR||a===i.TYPE_IHDR){if(this._crc=new n,this._crc.write(r.from(o)),this._chunks[a])return this._chunks[a](e);s?this.read(e+4,this._skipChunk.bind(this)):this.error(new Error("Unsupported critical chunk type "+o))}else this.error(new Error("Expected IHDR on beggining"))},a.prototype._skipChunk=function(){this.read(8,this._parseChunkBegin.bind(this))},a.prototype._handleChunkEnd=function(){this.read(4,this._parseChunkEnd.bind(this))},a.prototype._parseChunkEnd=function(t){let e=t.readInt32BE(0),r=this._crc.crc32();this._options.checkCRC&&r!==e?this.error(new Error("Crc error - "+e+" - "+r)):this._hasIEND||this.read(8,this._parseChunkBegin.bind(this))},a.prototype._handleIHDR=function(t){this.read(t,this._parseIHDR.bind(this))},a.prototype._parseIHDR=function(t){this._crc.write(t);let e=t.readUInt32BE(0),r=t.readUInt32BE(4),n=t[8],a=t[9],o=t[10],s=t[11],h=t[12];if(8!==n&&4!==n&&2!==n&&1!==n&&16!==n)return void this.error(new Error("Unsupported bit depth "+n));if(!(a in i.COLORTYPE_TO_BPP_MAP))return void this.error(new Error("Unsupported color type"));if(0!==o)return void this.error(new Error("Unsupported compression method"));if(0!==s)return void this.error(new Error("Unsupported filter method"));if(0!==h&&1!==h)return void this.error(new Error("Unsupported interlace method"));this._colorType=a;let l=i.COLORTYPE_TO_BPP_MAP[this._colorType];this._hasIHDR=!0,this.metadata({width:e,height:r,depth:n,interlace:Boolean(h),palette:Boolean(a&i.COLORTYPE_PALETTE),color:Boolean(a&i.COLORTYPE_COLOR),alpha:Boolean(a&i.COLORTYPE_ALPHA),bpp:l,colorType:a}),this._handleChunkEnd()},a.prototype._handlePLTE=function(t){this.read(t,this._parsePLTE.bind(this))},a.prototype._parsePLTE=function(t){this._crc.write(t);let e=Math.floor(t.length/3);for(let r=0;r<e;r++)this._palette.push([t[3*r],t[3*r+1],t[3*r+2],255]);this.palette(this._palette),this._handleChunkEnd()},a.prototype._handleTRNS=function(t){this.simpleTransparency(),this.read(t,this._parseTRNS.bind(this))},a.prototype._parseTRNS=function(t){if(this._crc.write(t),this._colorType===i.COLORTYPE_PALETTE_COLOR){if(0===this._palette.length)return void this.error(new Error("Transparency chunk must be after palette"));if(t.length>this._palette.length)return void this.error(new Error("More transparent colors than palette size"));for(let e=0;e<t.length;e++)this._palette[e][3]=t[e];this.palette(this._palette)}this._colorType===i.COLORTYPE_GRAYSCALE&&this.transColor([t.readUInt16BE(0)]),this._colorType===i.COLORTYPE_COLOR&&this.transColor([t.readUInt16BE(0),t.readUInt16BE(2),t.readUInt16BE(4)]),this._handleChunkEnd()},a.prototype._handleGAMA=function(t){this.read(t,this._parseGAMA.bind(this))},a.prototype._parseGAMA=function(t){this._crc.write(t),this.gamma(t.readUInt32BE(0)/i.GAMMA_DIVISION),this._handleChunkEnd()},a.prototype._handleIDAT=function(t){this._emittedHeadersFinished||(this._emittedHeadersFinished=!0,this.headersFinished()),this.read(-t,this._parseIDAT.bind(this,t))},a.prototype._parseIDAT=function(t,e){if(this._crc.write(e),this._colorType===i.COLORTYPE_PALETTE_COLOR&&0===this._palette.length)throw new Error("Expected palette not found");this.inflateData(e);let r=t-e.length;r>0?this._handleIDAT(r):this._handleChunkEnd()},a.prototype._handleIEND=function(t){this.read(t,this._parseIEND.bind(this))},a.prototype._parseIEND=function(t){this._crc.write(t),this._hasIEND=!0,this._handleChunkEnd(),this.finished&&this.finished()}}).call(this)}).call(this,t("buffer").Buffer)},{"./constants":4,"./crc":5,buffer:33}],19:[function(t,e,r){"use strict";let i=t("./parser-sync"),n=t("./packer-sync");r.read=function(t,e){return i(t,e||{})},r.write=function(t,e){return n(t,e)}},{"./packer-sync":13,"./parser-sync":17}],20:[function(t,e,r){(function(e,i){(function(){"use strict";let n=t("util"),a=t("stream"),o=t("./parser-async"),s=t("./packer-async"),h=t("./png-sync"),l=r.PNG=function(t){a.call(this),t=t||{},this.width=0|t.width,this.height=0|t.height,this.data=this.width>0&&this.height>0?i.alloc(4*this.width*this.height):null,t.fill&&this.data&&this.data.fill(0),this.gamma=0,this.readable=this.writable=!0,this._parser=new o(t),this._parser.on("error",this.emit.bind(this,"error")),this._parser.on("close",this._handleClose.bind(this)),this._parser.on("metadata",this._metadata.bind(this)),this._parser.on("gamma",this._gamma.bind(this)),this._parser.on("parsed",function(t){this.data=t,this.emit("parsed",t)}.bind(this)),this._packer=new s(t),this._packer.on("data",this.emit.bind(this,"data")),this._packer.on("end",this.emit.bind(this,"end")),this._parser.on("close",this._handleClose.bind(this)),this._packer.on("error",this.emit.bind(this,"error"))};n.inherits(l,a),l.sync=h,l.prototype.pack=function(){return this.data&&this.data.length?(e.nextTick(function(){this._packer.pack(this.data,this.width,this.height,this.gamma)}.bind(this)),this):(this.emit("error","No data provided"),this)},l.prototype.parse=function(t,e){if(e){let t,r;t=function(t){this.removeListener("error",r),this.data=t,e(null,this)}.bind(this),r=function(r){this.removeListener("parsed",t),e(r,null)}.bind(this),this.once("parsed",t),this.once("error",r)}return this.end(t),this},l.prototype.write=function(t){return this._parser.write(t),!0},l.prototype.end=function(t){this._parser.end(t)},l.prototype._metadata=function(t){this.width=t.width,this.height=t.height,this.emit("metadata",t)},l.prototype._gamma=function(t){this.gamma=t},l.prototype._handleClose=function(){this._parser.writable||this._packer.readable||this.emit("close")},l.bitblt=function(t,e,r,i,n,a,o,s){if(i|=0,n|=0,a|=0,o|=0,s|=0,(r|=0)>t.width||i>t.height||r+n>t.width||i+a>t.height)throw new Error("bitblt reading outside image");if(o>e.width||s>e.height||o+n>e.width||s+a>e.height)throw new Error("bitblt writing outside image");for(let h=0;h<a;h++)t.data.copy(e.data,(s+h)*e.width+o<<2,(i+h)*t.width+r<<2,(i+h)*t.width+r+n<<2)},l.prototype.bitblt=function(t,e,r,i,n,a,o){return l.bitblt(this,t,e,r,i,n,a,o),this},l.adjustGamma=function(t){if(t.gamma){for(let e=0;e<t.height;e++)for(let r=0;r<t.width;r++){let i=t.width*e+r<<2;for(let e=0;e<3;e++){let r=t.data[i+e]/255;r=Math.pow(r,1/2.2/t.gamma),t.data[i+e]=Math.round(255*r)}}t.gamma=0}},l.prototype.adjustGamma=function(){l.adjustGamma(this)}}).call(this)}).call(this,t("_process"),t("buffer").Buffer)},{"./packer-async":12,"./parser-async":16,"./png-sync":19,_process:60,buffer:33,stream:61,util:81}],21:[function(t,e,r){(function(i,n){(function(){"use strict";let a=t("assert").ok,o=t("zlib"),s=t("util"),h=t("buffer").kMaxLength;function l(t){if(!(this instanceof l))return new l(t);t&&t.chunkSize<o.Z_MIN_CHUNK&&(t.chunkSize=o.Z_MIN_CHUNK),o.Inflate.call(this,t),this._offset=void 0===this._offset?this._outOffset:this._offset,this._buffer=this._buffer||this._outBuffer,t&&null!=t.maxLength&&(this._maxLength=t.maxLength)}function f(t,e){e&&i.nextTick(e),t._handle&&(t._handle.close(),t._handle=null)}function u(t,e){return function(t,e){if("string"==typeof e&&(e=n.from(e)),!(e instanceof n))throw new TypeError("Not a string or buffer");let r=t._finishFlushFlag;return null==r&&(r=o.Z_FINISH),t._processChunk(e,r)}(new l(e),t)}l.prototype._processChunk=function(t,e,r){if("function"==typeof r)return o.Inflate._processChunk.call(this,t,e,r);let i,s,l=this,u=t&&t.length,c=this._chunkSize-this._offset,d=this._maxLength,p=0,m=[],g=0;function b(t,e){if(l._hadError)return;let r=c-e;if(a(r>=0,"have should not go down"),r>0){let t=l._buffer.slice(l._offset,l._offset+r);if(l._offset+=r,t.length>d&&(t=t.slice(0,d)),m.push(t),g+=t.length,d-=t.length,0===d)return!1}return(0===e||l._offset>=l._chunkSize)&&(c=l._chunkSize,l._offset=0,l._buffer=n.allocUnsafe(l._chunkSize)),0===e&&(p+=u-t,u=t,!0)}this.on("error",(function(t){i=t})),a(this._handle,"zlib binding closed");do{s=this._handle.writeSync(e,t,p,u,this._buffer,this._offset,c),s=s||this._writeState}while(!this._hadError&&b(s[0],s[1]));if(this._hadError)throw i;if(g>=h)throw f(this),new RangeError("Cannot create final Buffer. It would be larger than 0x"+h.toString(16)+" bytes");let _=n.concat(m,g);return f(this),_},s.inherits(l,o.Inflate),e.exports=r=u,r.Inflate=l,r.createInflate=function(t){return new l(t)},r.inflateSync=u}).call(this)}).call(this,t("_process"),t("buffer").Buffer)},{_process:60,assert:23,buffer:33,util:81,zlib:32}],22:[function(t,e,r){"use strict";let i=e.exports=function(t){this._buffer=t,this._reads=[]};i.prototype.read=function(t,e){this._reads.push({length:Math.abs(t),allowLess:t<0,func:e})},i.prototype.process=function(){for(;this._reads.length>0&&this._buffer.length;){let t=this._reads[0];if(!this._buffer.length||!(this._buffer.length>=t.length||t.allowLess))break;{this._reads.shift();let e=this._buffer;this._buffer=e.slice(t.length),t.func.call(this,e.slice(0,t.length))}}if(this._reads.length>0)throw new Error("There are some read requests waitng on finished stream");if(this._buffer.length>0)throw new Error("unrecognised content at end of stream")}},{}],23:[function(t,e,i){(function(r){(function(){"use strict";function i(t,e){if(t===e)return 0;for(var r=t.length,i=e.length,n=0,a=Math.min(r,i);n<a;++n)if(t[n]!==e[n]){r=t[n],i=e[n];break}return r<i?-1:i<r?1:0}function n(t){return r.Buffer&&"function"==typeof r.Buffer.isBuffer?r.Buffer.isBuffer(t):!(null==t||!t._isBuffer)}var a=t("util/"),o=Object.prototype.hasOwnProperty,s=Array.prototype.slice,h="foo"===function(){}.name;function l(t){return Object.prototype.toString.call(t)}function f(t){return!n(t)&&"function"==typeof r.ArrayBuffer&&("function"==typeof ArrayBuffer.isView?ArrayBuffer.isView(t):!!t&&(t instanceof DataView||!!(t.buffer&&t.buffer instanceof ArrayBuffer)))}var u=e.exports=b,c=/\s*function\s+([^\(\s]*)\s*/;function d(t){if(a.isFunction(t)){if(h)return t.name;var e=t.toString().match(c);return e&&e[1]}}function p(t,e){return"string"==typeof t?t.length<e?t:t.slice(0,e):t}function m(t){if(h||!a.isFunction(t))return a.inspect(t);var e=d(t);return"[Function"+(e?": "+e:"")+"]"}function g(t,e,r,i,n){throw new u.AssertionError({message:r,actual:t,expected:e,operator:i,stackStartFunction:n})}function b(t,e){t||g(t,!0,e,"==",u.ok)}function _(t,e,r,o){if(t===e)return!0;if(n(t)&&n(e))return 0===i(t,e);if(a.isDate(t)&&a.isDate(e))return t.getTime()===e.getTime();if(a.isRegExp(t)&&a.isRegExp(e))return t.source===e.source&&t.global===e.global&&t.multiline===e.multiline&&t.lastIndex===e.lastIndex&&t.ignoreCase===e.ignoreCase;if(null!==t&&"object"==typeof t||null!==e&&"object"==typeof e){if(f(t)&&f(e)&&l(t)===l(e)&&!(t instanceof Float32Array||t instanceof Float64Array))return 0===i(new Uint8Array(t.buffer),new Uint8Array(e.buffer));if(n(t)!==n(e))return!1;var h=(o=o||{actual:[],expected:[]}).actual.indexOf(t);return-1!==h&&h===o.expected.indexOf(e)||(o.actual.push(t),o.expected.push(e),function(t,e,r,i){if(null==t||null==e)return!1;if(a.isPrimitive(t)||a.isPrimitive(e))return t===e;if(r&&Object.getPrototypeOf(t)!==Object.getPrototypeOf(e))return!1;var n=y(t),o=y(e);if(n&&!o||!n&&o)return!1;if(n)return _(t=s.call(t),e=s.call(e),r);var h,l,f=x(t),u=x(e);if(f.length!==u.length)return!1;for(f.sort(),u.sort(),l=f.length-1;l>=0;l--)if(f[l]!==u[l])return!1;for(l=f.length-1;l>=0;l--)if(!_(t[h=f[l]],e[h],r,i))return!1;return!0}(t,e,r,o))}return r?t===e:t==e}function y(t){return"[object Arguments]"==Object.prototype.toString.call(t)}function w(t,e){if(!t||!e)return!1;if("[object RegExp]"==Object.prototype.toString.call(e))return e.test(t);try{if(t instanceof e)return!0}catch(t){}return!Error.isPrototypeOf(e)&&!0===e.call({},t)}function v(t,e,r,i){var n;if("function"!=typeof e)throw new TypeError('"block" argument must be a function');"string"==typeof r&&(i=r,r=null),n=function(t){var e;try{t()}catch(t){e=t}return e}(e),i=(r&&r.name?" ("+r.name+").":".")+(i?" "+i:"."),t&&!n&&g(n,r,"Missing expected exception"+i);var o="string"==typeof i,s=!t&&n&&!r;if((!t&&a.isError(n)&&o&&w(n,r)||s)&&g(n,r,"Got unwanted exception"+i),t&&n&&r&&!w(n,r)||!t&&n)throw n}u.AssertionError=function(t){this.name="AssertionError",this.actual=t.actual,this.expected=t.expected,this.operator=t.operator,t.message?(this.message=t.message,this.generatedMessage=!1):(this.message=function(t){return p(m(t.actual),128)+" "+t.operator+" "+p(m(t.expected),128)}(this),this.generatedMessage=!0);var e=t.stackStartFunction||g;if(Error.captureStackTrace)Error.captureStackTrace(this,e);else{var r=new Error;if(r.stack){var i=r.stack,n=d(e),a=i.indexOf("\n"+n);if(a>=0){var o=i.indexOf("\n",a+1);i=i.substring(o+1)}this.stack=i}}},a.inherits(u.AssertionError,Error),u.fail=g,u.ok=b,u.equal=function(t,e,r){t!=e&&g(t,e,r,"==",u.equal)},u.notEqual=function(t,e,r){t==e&&g(t,e,r,"!=",u.notEqual)},u.deepEqual=function(t,e,r){_(t,e,!1)||g(t,e,r,"deepEqual",u.deepEqual)},u.deepStrictEqual=function(t,e,r){_(t,e,!0)||g(t,e,r,"deepStrictEqual",u.deepStrictEqual)},u.notDeepEqual=function(t,e,r){_(t,e,!1)&&g(t,e,r,"notDeepEqual",u.notDeepEqual)},u.notDeepStrictEqual=function t(e,r,i){_(e,r,!0)&&g(e,r,i,"notDeepStrictEqual",t)},u.strictEqual=function(t,e,r){t!==e&&g(t,e,r,"===",u.strictEqual)},u.notStrictEqual=function(t,e,r){t===e&&g(t,e,r,"!==",u.notStrictEqual)},u.throws=function(t,e,r){v(!0,t,e,r)},u.doesNotThrow=function(t,e,r){v(!1,t,e,r)},u.ifError=function(t){if(t)throw t};var x=Object.keys||function(t){var e=[];for(var r in t)o.call(t,r)&&e.push(r);return e}}).call(this)}).call(this,void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"util/":26}],24:[function(t,e,r){"function"==typeof Object.create?e.exports=function(t,e){t.super_=e,t.prototype=Object.create(e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}})}:e.exports=function(t,e){t.super_=e;var r=function(){};r.prototype=e.prototype,t.prototype=new r,t.prototype.constructor=t}},{}],25:[function(t,e,r){e.exports=function(t){return t&&"object"==typeof t&&"function"==typeof t.copy&&"function"==typeof t.fill&&"function"==typeof t.readUInt8}},{}],26:[function(t,e,i){(function(e,r){(function(){var n=/%[sdj%]/g;i.format=function(t){if(!b(t)){for(var e=[],r=0;r<arguments.length;r++)e.push(s(arguments[r]));return e.join(" ")}r=1;for(var i=arguments,a=i.length,o=String(t).replace(n,(function(t){if("%%"===t)return"%";if(r>=a)return t;switch(t){case"%s":return String(i[r++]);case"%d":return Number(i[r++]);case"%j":try{return JSON.stringify(i[r++])}catch(t){return"[Circular]"}default:return t}})),h=i[r];r<a;h=i[++r])m(h)||!w(h)?o+=" "+h:o+=" "+s(h);return o},i.deprecate=function(t,n){if(_(r.process))return function(){return i.deprecate(t,n).apply(this,arguments)};if(!0===e.noDeprecation)return t;var a=!1;return function(){if(!a){if(e.throwDeprecation)throw new Error(n);e.traceDeprecation?console.trace(n):console.error(n),a=!0}return t.apply(this,arguments)}};var a,o={};function s(t,e){var r={seen:[],stylize:l};return arguments.length>=3&&(r.depth=arguments[2]),arguments.length>=4&&(r.colors=arguments[3]),p(e)?r.showHidden=e:e&&i._extend(r,e),_(r.showHidden)&&(r.showHidden=!1),_(r.depth)&&(r.depth=2),_(r.colors)&&(r.colors=!1),_(r.customInspect)&&(r.customInspect=!0),r.colors&&(r.stylize=h),f(r,t,r.depth)}function h(t,e){var r=s.styles[e];return r?"["+s.colors[r][0]+"m"+t+"["+s.colors[r][1]+"m":t}function l(t,e){return t}function f(t,e,r){if(t.customInspect&&e&&E(e.inspect)&&e.inspect!==i.inspect&&(!e.constructor||e.constructor.prototype!==e)){var n=e.inspect(r,t);return b(n)||(n=f(t,n,r)),n}var a=function(t,e){if(_(e))return t.stylize("undefined","undefined");if(b(e)){var r="'"+JSON.stringify(e).replace(/^"|"$/g,"").replace(/'/g,"\\'").replace(/\\"/g,'"')+"'";return t.stylize(r,"string")}return g(e)?t.stylize(""+e,"number"):p(e)?t.stylize(""+e,"boolean"):m(e)?t.stylize("null","null"):void 0}(t,e);if(a)return a;var o=Object.keys(e),s=function(t){var e={};return t.forEach((function(t,r){e[t]=!0})),e}(o);if(t.showHidden&&(o=Object.getOwnPropertyNames(e)),x(e)&&(o.indexOf("message")>=0||o.indexOf("description")>=0))return u(e);if(0===o.length){if(E(e)){var h=e.name?": "+e.name:"";return t.stylize("[Function"+h+"]","special")}if(y(e))return t.stylize(RegExp.prototype.toString.call(e),"regexp");if(v(e))return t.stylize(Date.prototype.toString.call(e),"date");if(x(e))return u(e)}var l,w="",k=!1,S=["{","}"];return d(e)&&(k=!0,S=["[","]"]),E(e)&&(w=" [Function"+(e.name?": "+e.name:"")+"]"),y(e)&&(w=" "+RegExp.prototype.toString.call(e)),v(e)&&(w=" "+Date.prototype.toUTCString.call(e)),x(e)&&(w=" "+u(e)),0!==o.length||k&&0!=e.length?r<0?y(e)?t.stylize(RegExp.prototype.toString.call(e),"regexp"):t.stylize("[Object]","special"):(t.seen.push(e),l=k?function(t,e,r,i,n){for(var a=[],o=0,s=e.length;o<s;++o)A(e,String(o))?a.push(c(t,e,r,i,String(o),!0)):a.push("");return n.forEach((function(n){n.match(/^\d+$/)||a.push(c(t,e,r,i,n,!0))})),a}(t,e,r,s,o):o.map((function(i){return c(t,e,r,s,i,k)})),t.seen.pop(),function(t,e,r){return t.reduce((function(t,e){return e.indexOf("\n"),t+e.replace(/\u001b\[\d\d?m/g,"").length+1}),0)>60?r[0]+(""===e?"":e+"\n ")+" "+t.join(",\n  ")+" "+r[1]:r[0]+e+" "+t.join(", ")+" "+r[1]}(l,w,S)):S[0]+w+S[1]}function u(t){return"["+Error.prototype.toString.call(t)+"]"}function c(t,e,r,i,n,a){var o,s,h;if((h=Object.getOwnPropertyDescriptor(e,n)||{value:e[n]}).get?s=h.set?t.stylize("[Getter/Setter]","special"):t.stylize("[Getter]","special"):h.set&&(s=t.stylize("[Setter]","special")),A(i,n)||(o="["+n+"]"),s||(t.seen.indexOf(h.value)<0?(s=m(r)?f(t,h.value,null):f(t,h.value,r-1)).indexOf("\n")>-1&&(s=a?s.split("\n").map((function(t){return"  "+t})).join("\n").substr(2):"\n"+s.split("\n").map((function(t){return"   "+t})).join("\n")):s=t.stylize("[Circular]","special")),_(o)){if(a&&n.match(/^\d+$/))return s;(o=JSON.stringify(""+n)).match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)?(o=o.substr(1,o.length-2),o=t.stylize(o,"name")):(o=o.replace(/'/g,"\\'").replace(/\\"/g,'"').replace(/(^"|"$)/g,"'"),o=t.stylize(o,"string"))}return o+": "+s}function d(t){return Array.isArray(t)}function p(t){return"boolean"==typeof t}function m(t){return null===t}function g(t){return"number"==typeof t}function b(t){return"string"==typeof t}function _(t){return void 0===t}function y(t){return w(t)&&"[object RegExp]"===k(t)}function w(t){return"object"==typeof t&&null!==t}function v(t){return w(t)&&"[object Date]"===k(t)}function x(t){return w(t)&&("[object Error]"===k(t)||t instanceof Error)}function E(t){return"function"==typeof t}function k(t){return Object.prototype.toString.call(t)}function S(t){return t<10?"0"+t.toString(10):t.toString(10)}i.debuglog=function(t){if(_(a)&&(a=e.env.NODE_DEBUG||""),t=t.toUpperCase(),!o[t])if(new RegExp("\\b"+t+"\\b","i").test(a)){var r=e.pid;o[t]=function(){var e=i.format.apply(i,arguments);console.error("%s %d: %s",t,r,e)}}else o[t]=function(){};return o[t]},i.inspect=s,s.colors={bold:[1,22],italic:[3,23],underline:[4,24],inverse:[7,27],white:[37,39],grey:[90,39],black:[30,39],blue:[34,39],cyan:[36,39],green:[32,39],magenta:[35,39],red:[31,39],yellow:[33,39]},s.styles={special:"cyan",number:"yellow",boolean:"yellow",undefined:"grey",null:"bold",string:"green",date:"magenta",regexp:"red"},i.isArray=d,i.isBoolean=p,i.isNull=m,i.isNullOrUndefined=function(t){return null==t},i.isNumber=g,i.isString=b,i.isSymbol=function(t){return"symbol"==typeof t},i.isUndefined=_,i.isRegExp=y,i.isObject=w,i.isDate=v,i.isError=x,i.isFunction=E,i.isPrimitive=function(t){return null===t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||"symbol"==typeof t||void 0===t},i.isBuffer=t("./support/isBuffer");var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function A(t,e){return Object.prototype.hasOwnProperty.call(t,e)}i.log=function(){var t,e;console.log("%s - %s",(t=new Date,e=[S(t.getHours()),S(t.getMinutes()),S(t.getSeconds())].join(":"),[t.getDate(),M[t.getMonth()],e].join(" ")),i.format.apply(i,arguments))},i.inherits=t("inherits"),i._extend=function(t,e){if(!e||!w(e))return t;for(var r=Object.keys(e),i=r.length;i--;)t[r[i]]=e[r[i]];return t}}).call(this)}).call(this,t("_process"),void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./support/isBuffer":25,_process:60,inherits:24}],27:[function(t,e,i){(function(r){(function(){"use strict";var i=t("array-filter");e.exports=function(){return i(["BigInt64Array","BigUint64Array","Float32Array","Float64Array","Int16Array","Int32Array","Int8Array","Uint16Array","Uint32Array","Uint8Array","Uint8ClampedArray"],(function(t){return"function"==typeof r[t]}))}}).call(this)}).call(this,void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"array-filter":28}],28:[function(t,e,r){e.exports=function(t,e,r){if(t.filter)return t.filter(e,r);if(null==t)throw new TypeError;if("function"!=typeof e)throw new TypeError;for(var n=[],a=0;a<t.length;a++)if(i.call(t,a)){var o=t[a];e.call(r,o,a,t)&&n.push(o)}return n};var i=Object.prototype.hasOwnProperty},{}],29:[function(t,e,r){"use strict";r.byteLength=function(t){var e=l(t),r=e[0],i=e[1];return 3*(r+i)/4-i},r.toByteArray=function(t){var e,r,i=l(t),o=i[0],s=i[1],h=new a(function(t,e,r){return 3*(e+r)/4-r}(0,o,s)),f=0,u=s>0?o-4:o;for(r=0;r<u;r+=4)e=n[t.charCodeAt(r)]<<18|n[t.charCodeAt(r+1)]<<12|n[t.charCodeAt(r+2)]<<6|n[t.charCodeAt(r+3)],h[f++]=e>>16&255,h[f++]=e>>8&255,h[f++]=255&e;return 2===s&&(e=n[t.charCodeAt(r)]<<2|n[t.charCodeAt(r+1)]>>4,h[f++]=255&e),1===s&&(e=n[t.charCodeAt(r)]<<10|n[t.charCodeAt(r+1)]<<4|n[t.charCodeAt(r+2)]>>2,h[f++]=e>>8&255,h[f++]=255&e),h},r.fromByteArray=function(t){for(var e,r=t.length,n=r%3,a=[],o=16383,s=0,h=r-n;s<h;s+=o)a.push(f(t,s,s+o>h?h:s+o));return 1===n?(e=t[r-1],a.push(i[e>>2]+i[e<<4&63]+"==")):2===n&&(e=(t[r-2]<<8)+t[r-1],a.push(i[e>>10]+i[e>>4&63]+i[e<<2&63]+"=")),a.join("")};for(var i=[],n=[],a="undefined"!=typeof Uint8Array?Uint8Array:Array,o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",s=0,h=o.length;s<h;++s)i[s]=o[s],n[o.charCodeAt(s)]=s;function l(t){var e=t.length;if(e%4>0)throw new Error("Invalid string. Length must be a multiple of 4");var r=t.indexOf("=");return-1===r&&(r=e),[r,r===e?0:4-r%4]}function f(t,e,r){for(var n,a=[],o=e;o<r;o+=3)n=(t[o]<<16&16711680)+(t[o+1]<<8&65280)+(255&t[o+2]),a.push(i[(s=n)>>18&63]+i[s>>12&63]+i[s>>6&63]+i[63&s]);var s;return a.join("")}n["-".charCodeAt(0)]=62,n["_".charCodeAt(0)]=63},{}],30:[function(t,e,r){},{}],31:[function(t,e,r){(function(e,i){(function(){"use strict";var n=t("assert"),a=t("pako/lib/zlib/zstream"),o=t("pako/lib/zlib/deflate.js"),s=t("pako/lib/zlib/inflate.js"),h=t("pako/lib/zlib/constants");for(var l in h)r[l]=h[l];r.NONE=0,r.DEFLATE=1,r.INFLATE=2,r.GZIP=3,r.GUNZIP=4,r.DEFLATERAW=5,r.INFLATERAW=6,r.UNZIP=7;function f(t){if("number"!=typeof t||t<r.DEFLATE||t>r.UNZIP)throw new TypeError("Bad argument");this.dictionary=null,this.err=0,this.flush=0,this.init_done=!1,this.level=0,this.memLevel=0,this.mode=t,this.strategy=0,this.windowBits=0,this.write_in_progress=!1,this.pending_close=!1,this.gzip_id_bytes_read=0}f.prototype.close=function(){this.write_in_progress?this.pending_close=!0:(this.pending_close=!1,n(this.init_done,"close before init"),n(this.mode<=r.UNZIP),this.mode===r.DEFLATE||this.mode===r.GZIP||this.mode===r.DEFLATERAW?o.deflateEnd(this.strm):this.mode!==r.INFLATE&&this.mode!==r.GUNZIP&&this.mode!==r.INFLATERAW&&this.mode!==r.UNZIP||s.inflateEnd(this.strm),this.mode=r.NONE,this.dictionary=null)},f.prototype.write=function(t,e,r,i,n,a,o){return this._write(!0,t,e,r,i,n,a,o)},f.prototype.writeSync=function(t,e,r,i,n,a,o){return this._write(!1,t,e,r,i,n,a,o)},f.prototype._write=function(t,a,o,s,h,l,f,u){if(n.equal(arguments.length,8),n(this.init_done,"write before init"),n(this.mode!==r.NONE,"already finalized"),n.equal(!1,this.write_in_progress,"write already in progress"),n.equal(!1,this.pending_close,"close is pending"),this.write_in_progress=!0,n.equal(!1,void 0===a,"must provide flush value"),this.write_in_progress=!0,a!==r.Z_NO_FLUSH&&a!==r.Z_PARTIAL_FLUSH&&a!==r.Z_SYNC_FLUSH&&a!==r.Z_FULL_FLUSH&&a!==r.Z_FINISH&&a!==r.Z_BLOCK)throw new Error("Invalid flush value");if(null==o&&(o=i.alloc(0),h=0,s=0),this.strm.avail_in=h,this.strm.input=o,this.strm.next_in=s,this.strm.avail_out=u,this.strm.output=l,this.strm.next_out=f,this.flush=a,!t)return this._process(),this._checkError()?this._afterSync():void 0;var c=this;return e.nextTick((function(){c._process(),c._after()})),this},f.prototype._afterSync=function(){var t=this.strm.avail_out,e=this.strm.avail_in;return this.write_in_progress=!1,[e,t]},f.prototype._process=function(){var t=null;switch(this.mode){case r.DEFLATE:case r.GZIP:case r.DEFLATERAW:this.err=o.deflate(this.strm,this.flush);break;case r.UNZIP:switch(this.strm.avail_in>0&&(t=this.strm.next_in),this.gzip_id_bytes_read){case 0:if(null===t)break;if(31!==this.strm.input[t]){this.mode=r.INFLATE;break}if(this.gzip_id_bytes_read=1,t++,1===this.strm.avail_in)break;case 1:if(null===t)break;139===this.strm.input[t]?(this.gzip_id_bytes_read=2,this.mode=r.GUNZIP):this.mode=r.INFLATE;break;default:throw new Error("invalid number of gzip magic number bytes read")}case r.INFLATE:case r.GUNZIP:case r.INFLATERAW:for(this.err=s.inflate(this.strm,this.flush),this.err===r.Z_NEED_DICT&&this.dictionary&&(this.err=s.inflateSetDictionary(this.strm,this.dictionary),this.err===r.Z_OK?this.err=s.inflate(this.strm,this.flush):this.err===r.Z_DATA_ERROR&&(this.err=r.Z_NEED_DICT));this.strm.avail_in>0&&this.mode===r.GUNZIP&&this.err===r.Z_STREAM_END&&0!==this.strm.next_in[0];)this.reset(),this.err=s.inflate(this.strm,this.flush);break;default:throw new Error("Unknown mode "+this.mode)}},f.prototype._checkError=function(){switch(this.err){case r.Z_OK:case r.Z_BUF_ERROR:if(0!==this.strm.avail_out&&this.flush===r.Z_FINISH)return this._error("unexpected end of file"),!1;break;case r.Z_STREAM_END:break;case r.Z_NEED_DICT:return null==this.dictionary?this._error("Missing dictionary"):this._error("Bad dictionary"),!1;default:return this._error("Zlib error"),!1}return!0},f.prototype._after=function(){if(this._checkError()){var t=this.strm.avail_out,e=this.strm.avail_in;this.write_in_progress=!1,this.callback(e,t),this.pending_close&&this.close()}},f.prototype._error=function(t){this.strm.msg&&(t=this.strm.msg),this.onerror(t,this.err),this.write_in_progress=!1,this.pending_close&&this.close()},f.prototype.init=function(t,e,i,a,o){n(4===arguments.length||5===arguments.length,"init(windowBits, level, memLevel, strategy, [dictionary])"),n(t>=8&&t<=15,"invalid windowBits"),n(e>=-1&&e<=9,"invalid compression level"),n(i>=1&&i<=9,"invalid memlevel"),n(a===r.Z_FILTERED||a===r.Z_HUFFMAN_ONLY||a===r.Z_RLE||a===r.Z_FIXED||a===r.Z_DEFAULT_STRATEGY,"invalid strategy"),this._init(e,t,i,a,o),this._setDictionary()},f.prototype.params=function(){throw new Error("deflateParams Not supported")},f.prototype.reset=function(){this._reset(),this._setDictionary()},f.prototype._init=function(t,e,i,n,h){switch(this.level=t,this.windowBits=e,this.memLevel=i,this.strategy=n,this.flush=r.Z_NO_FLUSH,this.err=r.Z_OK,this.mode!==r.GZIP&&this.mode!==r.GUNZIP||(this.windowBits+=16),this.mode===r.UNZIP&&(this.windowBits+=32),this.mode!==r.DEFLATERAW&&this.mode!==r.INFLATERAW||(this.windowBits=-1*this.windowBits),this.strm=new a,this.mode){case r.DEFLATE:case r.GZIP:case r.DEFLATERAW:this.err=o.deflateInit2(this.strm,this.level,r.Z_DEFLATED,this.windowBits,this.memLevel,this.strategy);break;case r.INFLATE:case r.GUNZIP:case r.INFLATERAW:case r.UNZIP:this.err=s.inflateInit2(this.strm,this.windowBits);break;default:throw new Error("Unknown mode "+this.mode)}this.err!==r.Z_OK&&this._error("Init error"),this.dictionary=h,this.write_in_progress=!1,this.init_done=!0},f.prototype._setDictionary=function(){if(null!=this.dictionary){switch(this.err=r.Z_OK,this.mode){case r.DEFLATE:case r.DEFLATERAW:this.err=o.deflateSetDictionary(this.strm,this.dictionary)}this.err!==r.Z_OK&&this._error("Failed to set dictionary")}},f.prototype._reset=function(){switch(this.err=r.Z_OK,this.mode){case r.DEFLATE:case r.DEFLATERAW:case r.GZIP:this.err=o.deflateReset(this.strm);break;case r.INFLATE:case r.INFLATERAW:case r.GUNZIP:this.err=s.inflateReset(this.strm)}this.err!==r.Z_OK&&this._error("Failed to reset stream")},r.Zlib=f}).call(this)}).call(this,t("_process"),t("buffer").Buffer)},{_process:60,assert:23,buffer:33,"pako/lib/zlib/constants":51,"pako/lib/zlib/deflate.js":53,"pako/lib/zlib/inflate.js":55,"pako/lib/zlib/zstream":59}],32:[function(t,e,r){(function(e){(function(){"use strict";var i=t("buffer").Buffer,n=t("stream").Transform,a=t("./binding"),o=t("util"),s=t("assert").ok,h=t("buffer").kMaxLength,l="Cannot create final Buffer. It would be larger than 0x"+h.toString(16)+" bytes";a.Z_MIN_WINDOWBITS=8,a.Z_MAX_WINDOWBITS=15,a.Z_DEFAULT_WINDOWBITS=15,a.Z_MIN_CHUNK=64,a.Z_MAX_CHUNK=1/0,a.Z_DEFAULT_CHUNK=16384,a.Z_MIN_MEMLEVEL=1,a.Z_MAX_MEMLEVEL=9,a.Z_DEFAULT_MEMLEVEL=8,a.Z_MIN_LEVEL=-1,a.Z_MAX_LEVEL=9,a.Z_DEFAULT_LEVEL=a.Z_DEFAULT_COMPRESSION;for(var f=Object.keys(a),u=0;u<f.length;u++){var c=f[u];c.match(/^Z/)&&Object.defineProperty(r,c,{enumerable:!0,value:a[c],writable:!1})}for(var d={Z_OK:a.Z_OK,Z_STREAM_END:a.Z_STREAM_END,Z_NEED_DICT:a.Z_NEED_DICT,Z_ERRNO:a.Z_ERRNO,Z_STREAM_ERROR:a.Z_STREAM_ERROR,Z_DATA_ERROR:a.Z_DATA_ERROR,Z_MEM_ERROR:a.Z_MEM_ERROR,Z_BUF_ERROR:a.Z_BUF_ERROR,Z_VERSION_ERROR:a.Z_VERSION_ERROR},p=Object.keys(d),m=0;m<p.length;m++){var g=p[m];d[d[g]]=g}function b(t,e,r){var n=[],a=0;function o(){for(var e;null!==(e=t.read());)n.push(e),a+=e.length;t.once("readable",o)}function s(){var e,o=null;a>=h?o=new RangeError(l):e=i.concat(n,a),n=[],t.close(),r(o,e)}t.on("error",(function(e){t.removeListener("end",s),t.removeListener("readable",o),r(e)})),t.on("end",s),t.end(e),o()}function _(t,e){if("string"==typeof e&&(e=i.from(e)),!i.isBuffer(e))throw new TypeError("Not a string or buffer");var r=t._finishFlushFlag;return t._processChunk(e,r)}function y(t){if(!(this instanceof y))return new y(t);A.call(this,t,a.DEFLATE)}function w(t){if(!(this instanceof w))return new w(t);A.call(this,t,a.INFLATE)}function v(t){if(!(this instanceof v))return new v(t);A.call(this,t,a.GZIP)}function x(t){if(!(this instanceof x))return new x(t);A.call(this,t,a.GUNZIP)}function E(t){if(!(this instanceof E))return new E(t);A.call(this,t,a.DEFLATERAW)}function k(t){if(!(this instanceof k))return new k(t);A.call(this,t,a.INFLATERAW)}function S(t){if(!(this instanceof S))return new S(t);A.call(this,t,a.UNZIP)}function M(t){return t===a.Z_NO_FLUSH||t===a.Z_PARTIAL_FLUSH||t===a.Z_SYNC_FLUSH||t===a.Z_FULL_FLUSH||t===a.Z_FINISH||t===a.Z_BLOCK}function A(t,e){var o=this;if(this._opts=t=t||{},this._chunkSize=t.chunkSize||r.Z_DEFAULT_CHUNK,n.call(this,t),t.flush&&!M(t.flush))throw new Error("Invalid flush flag: "+t.flush);if(t.finishFlush&&!M(t.finishFlush))throw new Error("Invalid flush flag: "+t.finishFlush);if(this._flushFlag=t.flush||a.Z_NO_FLUSH,this._finishFlushFlag=void 0!==t.finishFlush?t.finishFlush:a.Z_FINISH,t.chunkSize&&(t.chunkSize<r.Z_MIN_CHUNK||t.chunkSize>r.Z_MAX_CHUNK))throw new Error("Invalid chunk size: "+t.chunkSize);if(t.windowBits&&(t.windowBits<r.Z_MIN_WINDOWBITS||t.windowBits>r.Z_MAX_WINDOWBITS))throw new Error("Invalid windowBits: "+t.windowBits);if(t.level&&(t.level<r.Z_MIN_LEVEL||t.level>r.Z_MAX_LEVEL))throw new Error("Invalid compression level: "+t.level);if(t.memLevel&&(t.memLevel<r.Z_MIN_MEMLEVEL||t.memLevel>r.Z_MAX_MEMLEVEL))throw new Error("Invalid memLevel: "+t.memLevel);if(t.strategy&&t.strategy!=r.Z_FILTERED&&t.strategy!=r.Z_HUFFMAN_ONLY&&t.strategy!=r.Z_RLE&&t.strategy!=r.Z_FIXED&&t.strategy!=r.Z_DEFAULT_STRATEGY)throw new Error("Invalid strategy: "+t.strategy);if(t.dictionary&&!i.isBuffer(t.dictionary))throw new Error("Invalid dictionary: it should be a Buffer instance");this._handle=new a.Zlib(e);var s=this;this._hadError=!1,this._handle.onerror=function(t,e){I(s),s._hadError=!0;var i=new Error(t);i.errno=e,i.code=r.codes[e],s.emit("error",i)};var h=r.Z_DEFAULT_COMPRESSION;"number"==typeof t.level&&(h=t.level);var l=r.Z_DEFAULT_STRATEGY;"number"==typeof t.strategy&&(l=t.strategy),this._handle.init(t.windowBits||r.Z_DEFAULT_WINDOWBITS,h,t.memLevel||r.Z_DEFAULT_MEMLEVEL,l,t.dictionary),this._buffer=i.allocUnsafe(this._chunkSize),this._offset=0,this._level=h,this._strategy=l,this.once("end",this.close),Object.defineProperty(this,"_closed",{get:function(){return!o._handle},configurable:!0,enumerable:!0})}function I(t,r){r&&e.nextTick(r),t._handle&&(t._handle.close(),t._handle=null)}function B(t){t.emit("close")}Object.defineProperty(r,"codes",{enumerable:!0,value:Object.freeze(d),writable:!1}),r.Deflate=y,r.Inflate=w,r.Gzip=v,r.Gunzip=x,r.DeflateRaw=E,r.InflateRaw=k,r.Unzip=S,r.createDeflate=function(t){return new y(t)},r.createInflate=function(t){return new w(t)},r.createDeflateRaw=function(t){return new E(t)},r.createInflateRaw=function(t){return new k(t)},r.createGzip=function(t){return new v(t)},r.createGunzip=function(t){return new x(t)},r.createUnzip=function(t){return new S(t)},r.deflate=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new y(e),t,r)},r.deflateSync=function(t,e){return _(new y(e),t)},r.gzip=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new v(e),t,r)},r.gzipSync=function(t,e){return _(new v(e),t)},r.deflateRaw=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new E(e),t,r)},r.deflateRawSync=function(t,e){return _(new E(e),t)},r.unzip=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new S(e),t,r)},r.unzipSync=function(t,e){return _(new S(e),t)},r.inflate=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new w(e),t,r)},r.inflateSync=function(t,e){return _(new w(e),t)},r.gunzip=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new x(e),t,r)},r.gunzipSync=function(t,e){return _(new x(e),t)},r.inflateRaw=function(t,e,r){return"function"==typeof e&&(r=e,e={}),b(new k(e),t,r)},r.inflateRawSync=function(t,e){return _(new k(e),t)},o.inherits(A,n),A.prototype.params=function(t,i,n){if(t<r.Z_MIN_LEVEL||t>r.Z_MAX_LEVEL)throw new RangeError("Invalid compression level: "+t);if(i!=r.Z_FILTERED&&i!=r.Z_HUFFMAN_ONLY&&i!=r.Z_RLE&&i!=r.Z_FIXED&&i!=r.Z_DEFAULT_STRATEGY)throw new TypeError("Invalid strategy: "+i);if(this._level!==t||this._strategy!==i){var o=this;this.flush(a.Z_SYNC_FLUSH,(function(){s(o._handle,"zlib binding closed"),o._handle.params(t,i),o._hadError||(o._level=t,o._strategy=i,n&&n())}))}else e.nextTick(n)},A.prototype.reset=function(){return s(this._handle,"zlib binding closed"),this._handle.reset()},A.prototype._flush=function(t){this._transform(i.alloc(0),"",t)},A.prototype.flush=function(t,r){var n=this,o=this._writableState;("function"==typeof t||void 0===t&&!r)&&(r=t,t=a.Z_FULL_FLUSH),o.ended?r&&e.nextTick(r):o.ending?r&&this.once("end",r):o.needDrain?r&&this.once("drain",(function(){return n.flush(t,r)})):(this._flushFlag=t,this.write(i.alloc(0),"",r))},A.prototype.close=function(t){I(this,t),e.nextTick(B,this)},A.prototype._transform=function(t,e,r){var n,o=this._writableState,s=(o.ending||o.ended)&&(!t||o.length===t.length);return null===t||i.isBuffer(t)?this._handle?(s?n=this._finishFlushFlag:(n=this._flushFlag,t.length>=o.length&&(this._flushFlag=this._opts.flush||a.Z_NO_FLUSH)),void this._processChunk(t,n,r)):r(new Error("zlib binding closed")):r(new Error("invalid input"))},A.prototype._processChunk=function(t,e,r){var n=t&&t.length,a=this._chunkSize-this._offset,o=0,f=this,u="function"==typeof r;if(!u){var c,d=[],p=0;this.on("error",(function(t){c=t})),s(this._handle,"zlib binding closed");do{var m=this._handle.writeSync(e,t,o,n,this._buffer,this._offset,a)}while(!this._hadError&&_(m[0],m[1]));if(this._hadError)throw c;if(p>=h)throw I(this),new RangeError(l);var g=i.concat(d,p);return I(this),g}s(this._handle,"zlib binding closed");var b=this._handle.write(e,t,o,n,this._buffer,this._offset,a);function _(h,l){if(this&&(this.buffer=null,this.callback=null),!f._hadError){var c=a-l;if(s(c>=0,"have should not go down"),c>0){var m=f._buffer.slice(f._offset,f._offset+c);f._offset+=c,u?f.push(m):(d.push(m),p+=m.length)}if((0===l||f._offset>=f._chunkSize)&&(a=f._chunkSize,f._offset=0,f._buffer=i.allocUnsafe(f._chunkSize)),0===l){if(o+=n-h,n=h,!u)return!0;var g=f._handle.write(e,t,o,n,f._buffer,f._offset,f._chunkSize);return g.callback=_,void(g.buffer=t)}if(!u)return!1;r()}}b.buffer=t,b.callback=_},o.inherits(y,A),o.inherits(w,A),o.inherits(v,A),o.inherits(x,A),o.inherits(E,A),o.inherits(k,A),o.inherits(S,A)}).call(this)}).call(this,t("_process"))},{"./binding":31,_process:60,assert:23,buffer:33,stream:61,util:81}],33:[function(t,e,r){(function(e){(function(){"use strict";var e=t("base64-js"),i=t("ieee754");r.Buffer=o,r.SlowBuffer=function(t){return+t!=t&&(t=0),o.alloc(+t)},r.INSPECT_MAX_BYTES=50;var n=2147483647;function a(t){if(t>n)throw new RangeError('The value "'+t+'" is invalid for option "size"');var e=new Uint8Array(t);return e.__proto__=o.prototype,e}function o(t,e,r){if("number"==typeof t){if("string"==typeof e)throw new TypeError('The "string" argument must be of type string. Received type number');return l(t)}return s(t,e,r)}function s(t,e,r){if("string"==typeof t)return function(t,e){if("string"==typeof e&&""!==e||(e="utf8"),!o.isEncoding(e))throw new TypeError("Unknown encoding: "+e);var r=0|c(t,e),i=a(r),n=i.write(t,e);return n!==r&&(i=i.slice(0,n)),i}(t,e);if(ArrayBuffer.isView(t))return f(t);if(null==t)throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof t);if(N(t,ArrayBuffer)||t&&N(t.buffer,ArrayBuffer))return function(t,e,r){if(e<0||t.byteLength<e)throw new RangeError('"offset" is outside of buffer bounds');if(t.byteLength<e+(r||0))throw new RangeError('"length" is outside of buffer bounds');var i;return(i=void 0===e&&void 0===r?new Uint8Array(t):void 0===r?new Uint8Array(t,e):new Uint8Array(t,e,r)).__proto__=o.prototype,i}(t,e,r);if("number"==typeof t)throw new TypeError('The "value" argument must not be of type number. Received type number');var i=t.valueOf&&t.valueOf();if(null!=i&&i!==t)return o.from(i,e,r);var n=function(t){if(o.isBuffer(t)){var e=0|u(t.length),r=a(e);return 0===r.length||t.copy(r,0,0,e),r}return void 0!==t.length?"number"!=typeof t.length||F(t.length)?a(0):f(t):"Buffer"===t.type&&Array.isArray(t.data)?f(t.data):void 0}(t);if(n)return n;if("undefined"!=typeof Symbol&&null!=Symbol.toPrimitive&&"function"==typeof t[Symbol.toPrimitive])return o.from(t[Symbol.toPrimitive]("string"),e,r);throw new TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof t)}function h(t){if("number"!=typeof t)throw new TypeError('"size" argument must be of type number');if(t<0)throw new RangeError('The value "'+t+'" is invalid for option "size"')}function l(t){return h(t),a(t<0?0:0|u(t))}function f(t){for(var e=t.length<0?0:0|u(t.length),r=a(e),i=0;i<e;i+=1)r[i]=255&t[i];return r}function u(t){if(t>=n)throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x"+n.toString(16)+" bytes");return 0|t}function c(t,e){if(o.isBuffer(t))return t.length;if(ArrayBuffer.isView(t)||N(t,ArrayBuffer))return t.byteLength;if("string"!=typeof t)throw new TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type '+typeof t);var r=t.length,i=arguments.length>2&&!0===arguments[2];if(!i&&0===r)return 0;for(var n=!1;;)switch(e){case"ascii":case"latin1":case"binary":return r;case"utf8":case"utf-8":return U(t).length;case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return 2*r;case"hex":return r>>>1;case"base64":return z(t).length;default:if(n)return i?-1:U(t).length;e=(""+e).toLowerCase(),n=!0}}function d(t,e,r){var i=!1;if((void 0===e||e<0)&&(e=0),e>this.length)return"";if((void 0===r||r>this.length)&&(r=this.length),r<=0)return"";if((r>>>=0)<=(e>>>=0))return"";for(t||(t="utf8");;)switch(t){case"hex":return I(this,e,r);case"utf8":case"utf-8":return k(this,e,r);case"ascii":return M(this,e,r);case"latin1":case"binary":return A(this,e,r);case"base64":return E(this,e,r);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return B(this,e,r);default:if(i)throw new TypeError("Unknown encoding: "+t);t=(t+"").toLowerCase(),i=!0}}function p(t,e,r){var i=t[e];t[e]=t[r],t[r]=i}function m(t,e,r,i,n){if(0===t.length)return-1;if("string"==typeof r?(i=r,r=0):r>2147483647?r=2147483647:r<-2147483648&&(r=-2147483648),F(r=+r)&&(r=n?0:t.length-1),r<0&&(r=t.length+r),r>=t.length){if(n)return-1;r=t.length-1}else if(r<0){if(!n)return-1;r=0}if("string"==typeof e&&(e=o.from(e,i)),o.isBuffer(e))return 0===e.length?-1:g(t,e,r,i,n);if("number"==typeof e)return e&=255,"function"==typeof Uint8Array.prototype.indexOf?n?Uint8Array.prototype.indexOf.call(t,e,r):Uint8Array.prototype.lastIndexOf.call(t,e,r):g(t,[e],r,i,n);throw new TypeError("val must be string, number or Buffer")}function g(t,e,r,i,n){var a,o=1,s=t.length,h=e.length;if(void 0!==i&&("ucs2"===(i=String(i).toLowerCase())||"ucs-2"===i||"utf16le"===i||"utf-16le"===i)){if(t.length<2||e.length<2)return-1;o=2,s/=2,h/=2,r/=2}function l(t,e){return 1===o?t[e]:t.readUInt16BE(e*o)}if(n){var f=-1;for(a=r;a<s;a++)if(l(t,a)===l(e,-1===f?0:a-f)){if(-1===f&&(f=a),a-f+1===h)return f*o}else-1!==f&&(a-=a-f),f=-1}else for(r+h>s&&(r=s-h),a=r;a>=0;a--){for(var u=!0,c=0;c<h;c++)if(l(t,a+c)!==l(e,c)){u=!1;break}if(u)return a}return-1}function b(t,e,r,i){r=Number(r)||0;var n=t.length-r;i?(i=Number(i))>n&&(i=n):i=n;var a=e.length;i>a/2&&(i=a/2);for(var o=0;o<i;++o){var s=parseInt(e.substr(2*o,2),16);if(F(s))return o;t[r+o]=s}return o}function _(t,e,r,i){return D(U(e,t.length-r),t,r,i)}function y(t,e,r,i){return D(function(t){for(var e=[],r=0;r<t.length;++r)e.push(255&t.charCodeAt(r));return e}(e),t,r,i)}function w(t,e,r,i){return y(t,e,r,i)}function v(t,e,r,i){return D(z(e),t,r,i)}function x(t,e,r,i){return D(function(t,e){for(var r,i,n,a=[],o=0;o<t.length&&!((e-=2)<0);++o)i=(r=t.charCodeAt(o))>>8,n=r%256,a.push(n),a.push(i);return a}(e,t.length-r),t,r,i)}function E(t,r,i){return 0===r&&i===t.length?e.fromByteArray(t):e.fromByteArray(t.slice(r,i))}function k(t,e,r){r=Math.min(t.length,r);for(var i=[],n=e;n<r;){var a,o,s,h,l=t[n],f=null,u=l>239?4:l>223?3:l>191?2:1;if(n+u<=r)switch(u){case 1:l<128&&(f=l);break;case 2:128==(192&(a=t[n+1]))&&(h=(31&l)<<6|63&a)>127&&(f=h);break;case 3:a=t[n+1],o=t[n+2],128==(192&a)&&128==(192&o)&&(h=(15&l)<<12|(63&a)<<6|63&o)>2047&&(h<55296||h>57343)&&(f=h);break;case 4:a=t[n+1],o=t[n+2],s=t[n+3],128==(192&a)&&128==(192&o)&&128==(192&s)&&(h=(15&l)<<18|(63&a)<<12|(63&o)<<6|63&s)>65535&&h<1114112&&(f=h)}null===f?(f=65533,u=1):f>65535&&(f-=65536,i.push(f>>>10&1023|55296),f=56320|1023&f),i.push(f),n+=u}return function(t){var e=t.length;if(e<=S)return String.fromCharCode.apply(String,t);for(var r="",i=0;i<e;)r+=String.fromCharCode.apply(String,t.slice(i,i+=S));return r}(i)}r.kMaxLength=n,o.TYPED_ARRAY_SUPPORT=function(){try{var t=new Uint8Array(1);return t.__proto__={__proto__:Uint8Array.prototype,foo:function(){return 42}},42===t.foo()}catch(t){return!1}}(),o.TYPED_ARRAY_SUPPORT||"undefined"==typeof console||"function"!=typeof console.error||console.error("This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."),Object.defineProperty(o.prototype,"parent",{enumerable:!0,get:function(){if(o.isBuffer(this))return this.buffer}}),Object.defineProperty(o.prototype,"offset",{enumerable:!0,get:function(){if(o.isBuffer(this))return this.byteOffset}}),"undefined"!=typeof Symbol&&null!=Symbol.species&&o[Symbol.species]===o&&Object.defineProperty(o,Symbol.species,{value:null,configurable:!0,enumerable:!1,writable:!1}),o.poolSize=8192,o.from=function(t,e,r){return s(t,e,r)},o.prototype.__proto__=Uint8Array.prototype,o.__proto__=Uint8Array,o.alloc=function(t,e,r){return function(t,e,r){return h(t),t<=0?a(t):void 0!==e?"string"==typeof r?a(t).fill(e,r):a(t).fill(e):a(t)}(t,e,r)},o.allocUnsafe=function(t){return l(t)},o.allocUnsafeSlow=function(t){return l(t)},o.isBuffer=function(t){return null!=t&&!0===t._isBuffer&&t!==o.prototype},o.compare=function(t,e){if(N(t,Uint8Array)&&(t=o.from(t,t.offset,t.byteLength)),N(e,Uint8Array)&&(e=o.from(e,e.offset,e.byteLength)),!o.isBuffer(t)||!o.isBuffer(e))throw new TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array');if(t===e)return 0;for(var r=t.length,i=e.length,n=0,a=Math.min(r,i);n<a;++n)if(t[n]!==e[n]){r=t[n],i=e[n];break}return r<i?-1:i<r?1:0},o.isEncoding=function(t){switch(String(t).toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"latin1":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return!0;default:return!1}},o.concat=function(t,e){if(!Array.isArray(t))throw new TypeError('"list" argument must be an Array of Buffers');if(0===t.length)return o.alloc(0);var r;if(void 0===e)for(e=0,r=0;r<t.length;++r)e+=t[r].length;var i=o.allocUnsafe(e),n=0;for(r=0;r<t.length;++r){var a=t[r];if(N(a,Uint8Array)&&(a=o.from(a)),!o.isBuffer(a))throw new TypeError('"list" argument must be an Array of Buffers');a.copy(i,n),n+=a.length}return i},o.byteLength=c,o.prototype._isBuffer=!0,o.prototype.swap16=function(){var t=this.length;if(t%2!=0)throw new RangeError("Buffer size must be a multiple of 16-bits");for(var e=0;e<t;e+=2)p(this,e,e+1);return this},o.prototype.swap32=function(){var t=this.length;if(t%4!=0)throw new RangeError("Buffer size must be a multiple of 32-bits");for(var e=0;e<t;e+=4)p(this,e,e+3),p(this,e+1,e+2);return this},o.prototype.swap64=function(){var t=this.length;if(t%8!=0)throw new RangeError("Buffer size must be a multiple of 64-bits");for(var e=0;e<t;e+=8)p(this,e,e+7),p(this,e+1,e+6),p(this,e+2,e+5),p(this,e+3,e+4);return this},o.prototype.toString=function(){var t=this.length;return 0===t?"":0===arguments.length?k(this,0,t):d.apply(this,arguments)},o.prototype.toLocaleString=o.prototype.toString,o.prototype.equals=function(t){if(!o.isBuffer(t))throw new TypeError("Argument must be a Buffer");return this===t||0===o.compare(this,t)},o.prototype.inspect=function(){var t="",e=r.INSPECT_MAX_BYTES;return t=this.toString("hex",0,e).replace(/(.{2})/g,"$1 ").trim(),this.length>e&&(t+=" ... "),"<Buffer "+t+">"},o.prototype.compare=function(t,e,r,i,n){if(N(t,Uint8Array)&&(t=o.from(t,t.offset,t.byteLength)),!o.isBuffer(t))throw new TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type '+typeof t);if(void 0===e&&(e=0),void 0===r&&(r=t?t.length:0),void 0===i&&(i=0),void 0===n&&(n=this.length),e<0||r>t.length||i<0||n>this.length)throw new RangeError("out of range index");if(i>=n&&e>=r)return 0;if(i>=n)return-1;if(e>=r)return 1;if(this===t)return 0;for(var a=(n>>>=0)-(i>>>=0),s=(r>>>=0)-(e>>>=0),h=Math.min(a,s),l=this.slice(i,n),f=t.slice(e,r),u=0;u<h;++u)if(l[u]!==f[u]){a=l[u],s=f[u];break}return a<s?-1:s<a?1:0},o.prototype.includes=function(t,e,r){return-1!==this.indexOf(t,e,r)},o.prototype.indexOf=function(t,e,r){return m(this,t,e,r,!0)},o.prototype.lastIndexOf=function(t,e,r){return m(this,t,e,r,!1)},o.prototype.write=function(t,e,r,i){if(void 0===e)i="utf8",r=this.length,e=0;else if(void 0===r&&"string"==typeof e)i=e,r=this.length,e=0;else{if(!isFinite(e))throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");e>>>=0,isFinite(r)?(r>>>=0,void 0===i&&(i="utf8")):(i=r,r=void 0)}var n=this.length-e;if((void 0===r||r>n)&&(r=n),t.length>0&&(r<0||e<0)||e>this.length)throw new RangeError("Attempt to write outside buffer bounds");i||(i="utf8");for(var a=!1;;)switch(i){case"hex":return b(this,t,e,r);case"utf8":case"utf-8":return _(this,t,e,r);case"ascii":return y(this,t,e,r);case"latin1":case"binary":return w(this,t,e,r);case"base64":return v(this,t,e,r);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return x(this,t,e,r);default:if(a)throw new TypeError("Unknown encoding: "+i);i=(""+i).toLowerCase(),a=!0}},o.prototype.toJSON=function(){return{type:"Buffer",data:Array.prototype.slice.call(this._arr||this,0)}};var S=4096;function M(t,e,r){var i="";r=Math.min(t.length,r);for(var n=e;n<r;++n)i+=String.fromCharCode(127&t[n]);return i}function A(t,e,r){var i="";r=Math.min(t.length,r);for(var n=e;n<r;++n)i+=String.fromCharCode(t[n]);return i}function I(t,e,r){var i,n=t.length;(!e||e<0)&&(e=0),(!r||r<0||r>n)&&(r=n);for(var a="",o=e;o<r;++o)a+=(i=t[o])<16?"0"+i.toString(16):i.toString(16);return a}function B(t,e,r){for(var i=t.slice(e,r),n="",a=0;a<i.length;a+=2)n+=String.fromCharCode(i[a]+256*i[a+1]);return n}function T(t,e,r){if(t%1!=0||t<0)throw new RangeError("offset is not uint");if(t+e>r)throw new RangeError("Trying to access beyond buffer length")}function R(t,e,r,i,n,a){if(!o.isBuffer(t))throw new TypeError('"buffer" argument must be a Buffer instance');if(e>n||e<a)throw new RangeError('"value" argument is out of bounds');if(r+i>t.length)throw new RangeError("Index out of range")}function P(t,e,r,i,n,a){if(r+i>t.length)throw new RangeError("Index out of range");if(r<0)throw new RangeError("Index out of range")}function O(t,e,r,n,a){return e=+e,r>>>=0,a||P(t,0,r,4),i.write(t,e,r,n,23,4),r+4}function L(t,e,r,n,a){return e=+e,r>>>=0,a||P(t,0,r,8),i.write(t,e,r,n,52,8),r+8}o.prototype.slice=function(t,e){var r=this.length;(t=~~t)<0?(t+=r)<0&&(t=0):t>r&&(t=r),(e=void 0===e?r:~~e)<0?(e+=r)<0&&(e=0):e>r&&(e=r),e<t&&(e=t);var i=this.subarray(t,e);return i.__proto__=o.prototype,i},o.prototype.readUIntLE=function(t,e,r){t>>>=0,e>>>=0,r||T(t,e,this.length);for(var i=this[t],n=1,a=0;++a<e&&(n*=256);)i+=this[t+a]*n;return i},o.prototype.readUIntBE=function(t,e,r){t>>>=0,e>>>=0,r||T(t,e,this.length);for(var i=this[t+--e],n=1;e>0&&(n*=256);)i+=this[t+--e]*n;return i},o.prototype.readUInt8=function(t,e){return t>>>=0,e||T(t,1,this.length),this[t]},o.prototype.readUInt16LE=function(t,e){return t>>>=0,e||T(t,2,this.length),this[t]|this[t+1]<<8},o.prototype.readUInt16BE=function(t,e){return t>>>=0,e||T(t,2,this.length),this[t]<<8|this[t+1]},o.prototype.readUInt32LE=function(t,e){return t>>>=0,e||T(t,4,this.length),(this[t]|this[t+1]<<8|this[t+2]<<16)+16777216*this[t+3]},o.prototype.readUInt32BE=function(t,e){return t>>>=0,e||T(t,4,this.length),16777216*this[t]+(this[t+1]<<16|this[t+2]<<8|this[t+3])},o.prototype.readIntLE=function(t,e,r){t>>>=0,e>>>=0,r||T(t,e,this.length);for(var i=this[t],n=1,a=0;++a<e&&(n*=256);)i+=this[t+a]*n;return i>=(n*=128)&&(i-=Math.pow(2,8*e)),i},o.prototype.readIntBE=function(t,e,r){t>>>=0,e>>>=0,r||T(t,e,this.length);for(var i=e,n=1,a=this[t+--i];i>0&&(n*=256);)a+=this[t+--i]*n;return a>=(n*=128)&&(a-=Math.pow(2,8*e)),a},o.prototype.readInt8=function(t,e){return t>>>=0,e||T(t,1,this.length),128&this[t]?-1*(255-this[t]+1):this[t]},o.prototype.readInt16LE=function(t,e){t>>>=0,e||T(t,2,this.length);var r=this[t]|this[t+1]<<8;return 32768&r?4294901760|r:r},o.prototype.readInt16BE=function(t,e){t>>>=0,e||T(t,2,this.length);var r=this[t+1]|this[t]<<8;return 32768&r?4294901760|r:r},o.prototype.readInt32LE=function(t,e){return t>>>=0,e||T(t,4,this.length),this[t]|this[t+1]<<8|this[t+2]<<16|this[t+3]<<24},o.prototype.readInt32BE=function(t,e){return t>>>=0,e||T(t,4,this.length),this[t]<<24|this[t+1]<<16|this[t+2]<<8|this[t+3]},o.prototype.readFloatLE=function(t,e){return t>>>=0,e||T(t,4,this.length),i.read(this,t,!0,23,4)},o.prototype.readFloatBE=function(t,e){return t>>>=0,e||T(t,4,this.length),i.read(this,t,!1,23,4)},o.prototype.readDoubleLE=function(t,e){return t>>>=0,e||T(t,8,this.length),i.read(this,t,!0,52,8)},o.prototype.readDoubleBE=function(t,e){return t>>>=0,e||T(t,8,this.length),i.read(this,t,!1,52,8)},o.prototype.writeUIntLE=function(t,e,r,i){t=+t,e>>>=0,r>>>=0,i||R(this,t,e,r,Math.pow(2,8*r)-1,0);var n=1,a=0;for(this[e]=255&t;++a<r&&(n*=256);)this[e+a]=t/n&255;return e+r},o.prototype.writeUIntBE=function(t,e,r,i){t=+t,e>>>=0,r>>>=0,i||R(this,t,e,r,Math.pow(2,8*r)-1,0);var n=r-1,a=1;for(this[e+n]=255&t;--n>=0&&(a*=256);)this[e+n]=t/a&255;return e+r},o.prototype.writeUInt8=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,1,255,0),this[e]=255&t,e+1},o.prototype.writeUInt16LE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,2,65535,0),this[e]=255&t,this[e+1]=t>>>8,e+2},o.prototype.writeUInt16BE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,2,65535,0),this[e]=t>>>8,this[e+1]=255&t,e+2},o.prototype.writeUInt32LE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,4,4294967295,0),this[e+3]=t>>>24,this[e+2]=t>>>16,this[e+1]=t>>>8,this[e]=255&t,e+4},o.prototype.writeUInt32BE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,4,4294967295,0),this[e]=t>>>24,this[e+1]=t>>>16,this[e+2]=t>>>8,this[e+3]=255&t,e+4},o.prototype.writeIntLE=function(t,e,r,i){if(t=+t,e>>>=0,!i){var n=Math.pow(2,8*r-1);R(this,t,e,r,n-1,-n)}var a=0,o=1,s=0;for(this[e]=255&t;++a<r&&(o*=256);)t<0&&0===s&&0!==this[e+a-1]&&(s=1),this[e+a]=(t/o>>0)-s&255;return e+r},o.prototype.writeIntBE=function(t,e,r,i){if(t=+t,e>>>=0,!i){var n=Math.pow(2,8*r-1);R(this,t,e,r,n-1,-n)}var a=r-1,o=1,s=0;for(this[e+a]=255&t;--a>=0&&(o*=256);)t<0&&0===s&&0!==this[e+a+1]&&(s=1),this[e+a]=(t/o>>0)-s&255;return e+r},o.prototype.writeInt8=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,1,127,-128),t<0&&(t=255+t+1),this[e]=255&t,e+1},o.prototype.writeInt16LE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,2,32767,-32768),this[e]=255&t,this[e+1]=t>>>8,e+2},o.prototype.writeInt16BE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,2,32767,-32768),this[e]=t>>>8,this[e+1]=255&t,e+2},o.prototype.writeInt32LE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,4,2147483647,-2147483648),this[e]=255&t,this[e+1]=t>>>8,this[e+2]=t>>>16,this[e+3]=t>>>24,e+4},o.prototype.writeInt32BE=function(t,e,r){return t=+t,e>>>=0,r||R(this,t,e,4,2147483647,-2147483648),t<0&&(t=4294967295+t+1),this[e]=t>>>24,this[e+1]=t>>>16,this[e+2]=t>>>8,this[e+3]=255&t,e+4},o.prototype.writeFloatLE=function(t,e,r){return O(this,t,e,!0,r)},o.prototype.writeFloatBE=function(t,e,r){return O(this,t,e,!1,r)},o.prototype.writeDoubleLE=function(t,e,r){return L(this,t,e,!0,r)},o.prototype.writeDoubleBE=function(t,e,r){return L(this,t,e,!1,r)},o.prototype.copy=function(t,e,r,i){if(!o.isBuffer(t))throw new TypeError("argument should be a Buffer");if(r||(r=0),i||0===i||(i=this.length),e>=t.length&&(e=t.length),e||(e=0),i>0&&i<r&&(i=r),i===r)return 0;if(0===t.length||0===this.length)return 0;if(e<0)throw new RangeError("targetStart out of bounds");if(r<0||r>=this.length)throw new RangeError("Index out of range");if(i<0)throw new RangeError("sourceEnd out of bounds");i>this.length&&(i=this.length),t.length-e<i-r&&(i=t.length-e+r);var n=i-r;if(this===t&&"function"==typeof Uint8Array.prototype.copyWithin)this.copyWithin(e,r,i);else if(this===t&&r<e&&e<i)for(var a=n-1;a>=0;--a)t[a+e]=this[a+r];else Uint8Array.prototype.set.call(t,this.subarray(r,i),e);return n},o.prototype.fill=function(t,e,r,i){if("string"==typeof t){if("string"==typeof e?(i=e,e=0,r=this.length):"string"==typeof r&&(i=r,r=this.length),void 0!==i&&"string"!=typeof i)throw new TypeError("encoding must be a string");if("string"==typeof i&&!o.isEncoding(i))throw new TypeError("Unknown encoding: "+i);if(1===t.length){var n=t.charCodeAt(0);("utf8"===i&&n<128||"latin1"===i)&&(t=n)}}else"number"==typeof t&&(t&=255);if(e<0||this.length<e||this.length<r)throw new RangeError("Out of range index");if(r<=e)return this;var a;if(e>>>=0,r=void 0===r?this.length:r>>>0,t||(t=0),"number"==typeof t)for(a=e;a<r;++a)this[a]=t;else{var s=o.isBuffer(t)?t:o.from(t,i),h=s.length;if(0===h)throw new TypeError('The value "'+t+'" is invalid for argument "value"');for(a=0;a<r-e;++a)this[a+e]=s[a%h]}return this};var C=/[^+/0-9A-Za-z-_]/g;function U(t,e){var r;e=e||1/0;for(var i=t.length,n=null,a=[],o=0;o<i;++o){if((r=t.charCodeAt(o))>55295&&r<57344){if(!n){if(r>56319){(e-=3)>-1&&a.push(239,191,189);continue}if(o+1===i){(e-=3)>-1&&a.push(239,191,189);continue}n=r;continue}if(r<56320){(e-=3)>-1&&a.push(239,191,189),n=r;continue}r=65536+(n-55296<<10|r-56320)}else n&&(e-=3)>-1&&a.push(239,191,189);if(n=null,r<128){if((e-=1)<0)break;a.push(r)}else if(r<2048){if((e-=2)<0)break;a.push(r>>6|192,63&r|128)}else if(r<65536){if((e-=3)<0)break;a.push(r>>12|224,r>>6&63|128,63&r|128)}else{if(!(r<1114112))throw new Error("Invalid code point");if((e-=4)<0)break;a.push(r>>18|240,r>>12&63|128,r>>6&63|128,63&r|128)}}return a}function z(t){return e.toByteArray(function(t){if((t=(t=t.split("=")[0]).trim().replace(C,"")).length<2)return"";for(;t.length%4!=0;)t+="=";return t}(t))}function D(t,e,r,i){for(var n=0;n<i&&!(n+r>=e.length||n>=t.length);++n)e[n+r]=t[n];return n}function N(t,e){return t instanceof e||null!=t&&null!=t.constructor&&null!=t.constructor.name&&t.constructor.name===e.name}function F(t){return t!=t}}).call(this)}).call(this,t("buffer").Buffer)},{"base64-js":29,buffer:33,ieee754:44}],34:[function(t,e,r){"use strict";var i,n=TypeError,a=Object.getOwnPropertyDescriptor;if(a)try{a({},"")}catch(t){a=null}var o=function(){throw new n},s=a?function(){try{return o}catch(t){try{return a(arguments,"callee").get}catch(t){return o}}}():o,h=t("has-symbols")(),l=Object.getPrototypeOf||function(t){return t.__proto__},f=i,u=i,c=i,d=i,p="undefined"==typeof Uint8Array?i:l(Uint8Array),m={"%Array%":Array,"%ArrayBuffer%":"undefined"==typeof ArrayBuffer?i:ArrayBuffer,"%ArrayBufferPrototype%":"undefined"==typeof ArrayBuffer?i:ArrayBuffer.prototype,"%ArrayIteratorPrototype%":h?l([][Symbol.iterator]()):i,"%ArrayPrototype%":Array.prototype,"%ArrayProto_entries%":Array.prototype.entries,"%ArrayProto_forEach%":Array.prototype.forEach,"%ArrayProto_keys%":Array.prototype.keys,"%ArrayProto_values%":Array.prototype.values,"%AsyncFromSyncIteratorPrototype%":i,"%AsyncFunction%":u,"%AsyncFunctionPrototype%":i,"%AsyncGenerator%":i,"%AsyncGeneratorFunction%":c,"%AsyncGeneratorPrototype%":i,"%AsyncIteratorPrototype%":d&&h&&Symbol.asyncIterator?d[Symbol.asyncIterator]():i,"%Atomics%":"undefined"==typeof Atomics?i:Atomics,"%Boolean%":Boolean,"%BooleanPrototype%":Boolean.prototype,"%DataView%":"undefined"==typeof DataView?i:DataView,"%DataViewPrototype%":"undefined"==typeof DataView?i:DataView.prototype,"%Date%":Date,"%DatePrototype%":Date.prototype,"%decodeURI%":decodeURI,"%decodeURIComponent%":decodeURIComponent,"%encodeURI%":encodeURI,"%encodeURIComponent%":encodeURIComponent,"%Error%":Error,"%ErrorPrototype%":Error.prototype,"%eval%":eval,"%EvalError%":EvalError,"%EvalErrorPrototype%":EvalError.prototype,"%Float32Array%":"undefined"==typeof Float32Array?i:Float32Array,"%Float32ArrayPrototype%":"undefined"==typeof Float32Array?i:Float32Array.prototype,"%Float64Array%":"undefined"==typeof Float64Array?i:Float64Array,"%Float64ArrayPrototype%":"undefined"==typeof Float64Array?i:Float64Array.prototype,"%Function%":Function,"%FunctionPrototype%":Function.prototype,"%Generator%":i,"%GeneratorFunction%":f,"%GeneratorPrototype%":i,"%Int8Array%":"undefined"==typeof Int8Array?i:Int8Array,"%Int8ArrayPrototype%":"undefined"==typeof Int8Array?i:Int8Array.prototype,"%Int16Array%":"undefined"==typeof Int16Array?i:Int16Array,"%Int16ArrayPrototype%":"undefined"==typeof Int16Array?i:Int8Array.prototype,"%Int32Array%":"undefined"==typeof Int32Array?i:Int32Array,"%Int32ArrayPrototype%":"undefined"==typeof Int32Array?i:Int32Array.prototype,"%isFinite%":isFinite,"%isNaN%":isNaN,"%IteratorPrototype%":h?l(l([][Symbol.iterator]())):i,"%JSON%":"object"==typeof JSON?JSON:i,"%JSONParse%":"object"==typeof JSON?JSON.parse:i,"%Map%":"undefined"==typeof Map?i:Map,"%MapIteratorPrototype%":"undefined"!=typeof Map&&h?l((new Map)[Symbol.iterator]()):i,"%MapPrototype%":"undefined"==typeof Map?i:Map.prototype,"%Math%":Math,"%Number%":Number,"%NumberPrototype%":Number.prototype,"%Object%":Object,"%ObjectPrototype%":Object.prototype,"%ObjProto_toString%":Object.prototype.toString,"%ObjProto_valueOf%":Object.prototype.valueOf,"%parseFloat%":parseFloat,"%parseInt%":parseInt,"%Promise%":"undefined"==typeof Promise?i:Promise,"%PromisePrototype%":"undefined"==typeof Promise?i:Promise.prototype,"%PromiseProto_then%":"undefined"==typeof Promise?i:Promise.prototype.then,"%Promise_all%":"undefined"==typeof Promise?i:Promise.all,"%Promise_reject%":"undefined"==typeof Promise?i:Promise.reject,"%Promise_resolve%":"undefined"==typeof Promise?i:Promise.resolve,"%Proxy%":"undefined"==typeof Proxy?i:Proxy,"%RangeError%":RangeError,"%RangeErrorPrototype%":RangeError.prototype,"%ReferenceError%":ReferenceError,"%ReferenceErrorPrototype%":ReferenceError.prototype,"%Reflect%":"undefined"==typeof Reflect?i:Reflect,"%RegExp%":RegExp,"%RegExpPrototype%":RegExp.prototype,"%Set%":"undefined"==typeof Set?i:Set,"%SetIteratorPrototype%":"undefined"!=typeof Set&&h?l((new Set)[Symbol.iterator]()):i,"%SetPrototype%":"undefined"==typeof Set?i:Set.prototype,"%SharedArrayBuffer%":"undefined"==typeof SharedArrayBuffer?i:SharedArrayBuffer,"%SharedArrayBufferPrototype%":"undefined"==typeof SharedArrayBuffer?i:SharedArrayBuffer.prototype,"%String%":String,"%StringIteratorPrototype%":h?l(""[Symbol.iterator]()):i,"%StringPrototype%":String.prototype,"%Symbol%":h?Symbol:i,"%SymbolPrototype%":h?Symbol.prototype:i,"%SyntaxError%":SyntaxError,"%SyntaxErrorPrototype%":SyntaxError.prototype,"%ThrowTypeError%":s,"%TypedArray%":p,"%TypedArrayPrototype%":p?p.prototype:i,"%TypeError%":n,"%TypeErrorPrototype%":n.prototype,"%Uint8Array%":"undefined"==typeof Uint8Array?i:Uint8Array,"%Uint8ArrayPrototype%":"undefined"==typeof Uint8Array?i:Uint8Array.prototype,"%Uint8ClampedArray%":"undefined"==typeof Uint8ClampedArray?i:Uint8ClampedArray,"%Uint8ClampedArrayPrototype%":"undefined"==typeof Uint8ClampedArray?i:Uint8ClampedArray.prototype,"%Uint16Array%":"undefined"==typeof Uint16Array?i:Uint16Array,"%Uint16ArrayPrototype%":"undefined"==typeof Uint16Array?i:Uint16Array.prototype,"%Uint32Array%":"undefined"==typeof Uint32Array?i:Uint32Array,"%Uint32ArrayPrototype%":"undefined"==typeof Uint32Array?i:Uint32Array.prototype,"%URIError%":URIError,"%URIErrorPrototype%":URIError.prototype,"%WeakMap%":"undefined"==typeof WeakMap?i:WeakMap,"%WeakMapPrototype%":"undefined"==typeof WeakMap?i:WeakMap.prototype,"%WeakSet%":"undefined"==typeof WeakSet?i:WeakSet,"%WeakSetPrototype%":"undefined"==typeof WeakSet?i:WeakSet.prototype},g=t("function-bind").call(Function.call,String.prototype.replace),b=/[^%.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|%$))/g,_=/\\(\\)?/g,y=function(t){var e=[];return g(t,b,(function(t,r,i,n){e[e.length]=i?g(n,_,"$1"):r||t})),e},w=function(t,e){if(!(t in m))throw new SyntaxError("intrinsic "+t+" does not exist!");if(void 0===m[t]&&!e)throw new n("intrinsic "+t+" exists, but is not available. Please file an issue!");return m[t]};e.exports=function(t,e){if("string"!=typeof t||0===t.length)throw new TypeError("intrinsic name must be a non-empty string");if(arguments.length>1&&"boolean"!=typeof e)throw new TypeError('"allowMissing" argument must be a boolean');for(var r=y(t),i=w("%"+(r.length>0?r[0]:"")+"%",e),o=1;o<r.length;o+=1)if(null!=i)if(a&&o+1>=r.length){var s=a(i,r[o]);if(!e&&!(r[o]in i))throw new n("base intrinsic for "+t+" exists, but the property is not available.");i=s?s.get||s.value:i[r[o]]}else i=i[r[o]];return i}},{"function-bind":41,"has-symbols":42}],35:[function(t,e,r){"use strict";var i=t("function-bind"),n=t("../GetIntrinsic")("%Function%"),a=n.apply,o=n.call;e.exports=function(){return i.apply(o,arguments)},e.exports.apply=function(){return i.apply(a,arguments)}},{"../GetIntrinsic":34,"function-bind":41}],36:[function(t,e,r){"use strict";var i=t("../GetIntrinsic"),n=t("./callBind"),a=n(i("String.prototype.indexOf"));e.exports=function(t,e){var r=i(t,!!e);return"function"==typeof r&&a(t,".prototype.")?n(r):r}},{"../GetIntrinsic":34,"./callBind":35}],37:[function(t,e,r){"use strict";var i=t("../GetIntrinsic")("%Object.getOwnPropertyDescriptor%");if(i)try{i([],"length")}catch(t){i=null}e.exports=i},{"../GetIntrinsic":34}],38:[function(t,e,r){"use strict";var i,n="object"==typeof Reflect?Reflect:null,a=n&&"function"==typeof n.apply?n.apply:function(t,e,r){return Function.prototype.apply.call(t,e,r)};i=n&&"function"==typeof n.ownKeys?n.ownKeys:Object.getOwnPropertySymbols?function(t){return Object.getOwnPropertyNames(t).concat(Object.getOwnPropertySymbols(t))}:function(t){return Object.getOwnPropertyNames(t)};var o=Number.isNaN||function(t){return t!=t};function s(){s.init.call(this)}e.exports=s,e.exports.once=function(t,e){return new Promise((function(r,i){function n(){void 0!==a&&t.removeListener("error",a),r([].slice.call(arguments))}var a;"error"!==e&&(a=function(r){t.removeListener(e,n),i(r)},t.once("error",a)),t.once(e,n)}))},s.EventEmitter=s,s.prototype._events=void 0,s.prototype._eventsCount=0,s.prototype._maxListeners=void 0;var h=10;function l(t){if("function"!=typeof t)throw new TypeError('The "listener" argument must be of type Function. Received type '+typeof t)}function f(t){return void 0===t._maxListeners?s.defaultMaxListeners:t._maxListeners}function u(t,e,r,i){var n,a,o,s;if(l(r),void 0===(a=t._events)?(a=t._events=Object.create(null),t._eventsCount=0):(void 0!==a.newListener&&(t.emit("newListener",e,r.listener?r.listener:r),a=t._events),o=a[e]),void 0===o)o=a[e]=r,++t._eventsCount;else if("function"==typeof o?o=a[e]=i?[r,o]:[o,r]:i?o.unshift(r):o.push(r),(n=f(t))>0&&o.length>n&&!o.warned){o.warned=!0;var h=new Error("Possible EventEmitter memory leak detected. "+o.length+" "+String(e)+" listeners added. Use emitter.setMaxListeners() to increase limit");h.name="MaxListenersExceededWarning",h.emitter=t,h.type=e,h.count=o.length,s=h,console&&console.warn&&console.warn(s)}return t}function c(){if(!this.fired)return this.target.removeListener(this.type,this.wrapFn),this.fired=!0,0===arguments.length?this.listener.call(this.target):this.listener.apply(this.target,arguments)}function d(t,e,r){var i={fired:!1,wrapFn:void 0,target:t,type:e,listener:r},n=c.bind(i);return n.listener=r,i.wrapFn=n,n}function p(t,e,r){var i=t._events;if(void 0===i)return[];var n=i[e];return void 0===n?[]:"function"==typeof n?r?[n.listener||n]:[n]:r?function(t){for(var e=new Array(t.length),r=0;r<e.length;++r)e[r]=t[r].listener||t[r];return e}(n):g(n,n.length)}function m(t){var e=this._events;if(void 0!==e){var r=e[t];if("function"==typeof r)return 1;if(void 0!==r)return r.length}return 0}function g(t,e){for(var r=new Array(e),i=0;i<e;++i)r[i]=t[i];return r}Object.defineProperty(s,"defaultMaxListeners",{enumerable:!0,get:function(){return h},set:function(t){if("number"!=typeof t||t<0||o(t))throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received '+t+".");h=t}}),s.init=function(){void 0!==this._events&&this._events!==Object.getPrototypeOf(this)._events||(this._events=Object.create(null),this._eventsCount=0),this._maxListeners=this._maxListeners||void 0},s.prototype.setMaxListeners=function(t){if("number"!=typeof t||t<0||o(t))throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received '+t+".");return this._maxListeners=t,this},s.prototype.getMaxListeners=function(){return f(this)},s.prototype.emit=function(t){for(var e=[],r=1;r<arguments.length;r++)e.push(arguments[r]);var i="error"===t,n=this._events;if(void 0!==n)i=i&&void 0===n.error;else if(!i)return!1;if(i){var o;if(e.length>0&&(o=e[0]),o instanceof Error)throw o;var s=new Error("Unhandled error."+(o?" ("+o.message+")":""));throw s.context=o,s}var h=n[t];if(void 0===h)return!1;if("function"==typeof h)a(h,this,e);else{var l=h.length,f=g(h,l);for(r=0;r<l;++r)a(f[r],this,e)}return!0},s.prototype.addListener=function(t,e){return u(this,t,e,!1)},s.prototype.on=s.prototype.addListener,s.prototype.prependListener=function(t,e){return u(this,t,e,!0)},s.prototype.once=function(t,e){return l(e),this.on(t,d(this,t,e)),this},s.prototype.prependOnceListener=function(t,e){return l(e),this.prependListener(t,d(this,t,e)),this},s.prototype.removeListener=function(t,e){var r,i,n,a,o;if(l(e),void 0===(i=this._events))return this;if(void 0===(r=i[t]))return this;if(r===e||r.listener===e)0==--this._eventsCount?this._events=Object.create(null):(delete i[t],i.removeListener&&this.emit("removeListener",t,r.listener||e));else if("function"!=typeof r){for(n=-1,a=r.length-1;a>=0;a--)if(r[a]===e||r[a].listener===e){o=r[a].listener,n=a;break}if(n<0)return this;0===n?r.shift():function(t,e){for(;e+1<t.length;e++)t[e]=t[e+1];t.pop()}(r,n),1===r.length&&(i[t]=r[0]),void 0!==i.removeListener&&this.emit("removeListener",t,o||e)}return this},s.prototype.off=s.prototype.removeListener,s.prototype.removeAllListeners=function(t){var e,r,i;if(void 0===(r=this._events))return this;if(void 0===r.removeListener)return 0===arguments.length?(this._events=Object.create(null),this._eventsCount=0):void 0!==r[t]&&(0==--this._eventsCount?this._events=Object.create(null):delete r[t]),this;if(0===arguments.length){var n,a=Object.keys(r);for(i=0;i<a.length;++i)"removeListener"!==(n=a[i])&&this.removeAllListeners(n);return this.removeAllListeners("removeListener"),this._events=Object.create(null),this._eventsCount=0,this}if("function"==typeof(e=r[t]))this.removeListener(t,e);else if(void 0!==e)for(i=e.length-1;i>=0;i--)this.removeListener(t,e[i]);return this},s.prototype.listeners=function(t){return p(this,t,!0)},s.prototype.rawListeners=function(t){return p(this,t,!1)},s.listenerCount=function(t,e){return"function"==typeof t.listenerCount?t.listenerCount(e):m.call(t,e)},s.prototype.listenerCount=m,s.prototype.eventNames=function(){return this._eventsCount>0?i(this._events):[]}},{}],39:[function(t,e,r){var i=Object.prototype.hasOwnProperty,n=Object.prototype.toString;e.exports=function(t,e,r){if("[object Function]"!==n.call(e))throw new TypeError("iterator must be a function");var a=t.length;if(a===+a)for(var o=0;o<a;o++)e.call(r,t[o],o,t);else for(var s in t)i.call(t,s)&&e.call(r,t[s],s,t)}},{}],40:[function(t,e,r){"use strict";var i="Function.prototype.bind called on incompatible ",n=Array.prototype.slice,a=Object.prototype.toString,o="[object Function]";e.exports=function(t){var e=this;if("function"!=typeof e||a.call(e)!==o)throw new TypeError(i+e);for(var r,s=n.call(arguments,1),h=Math.max(0,e.length-s.length),l=[],f=0;f<h;f++)l.push("$"+f);if(r=Function("binder","return function ("+l.join(",")+"){ return binder.apply(this,arguments); }")((function(){if(this instanceof r){var i=e.apply(this,s.concat(n.call(arguments)));return Object(i)===i?i:this}return e.apply(t,s.concat(n.call(arguments)))})),e.prototype){var u=function(){};u.prototype=e.prototype,r.prototype=new u,u.prototype=null}return r}},{}],41:[function(t,e,r){"use strict";var i=t("./implementation");e.exports=Function.prototype.bind||i},{"./implementation":40}],42:[function(t,e,i){(function(r){(function(){"use strict";var i=r.Symbol,n=t("./shams");e.exports=function(){return"function"==typeof i&&"function"==typeof Symbol&&"symbol"==typeof i("foo")&&"symbol"==typeof Symbol("bar")&&n()}}).call(this)}).call(this,void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./shams":43}],43:[function(t,e,r){"use strict";e.exports=function(){if("function"!=typeof Symbol||"function"!=typeof Object.getOwnPropertySymbols)return!1;if("symbol"==typeof Symbol.iterator)return!0;var t={},e=Symbol("test"),r=Object(e);if("string"==typeof e)return!1;if("[object Symbol]"!==Object.prototype.toString.call(e))return!1;if("[object Symbol]"!==Object.prototype.toString.call(r))return!1;for(e in t[e]=42,t)return!1;if("function"==typeof Object.keys&&0!==Object.keys(t).length)return!1;if("function"==typeof Object.getOwnPropertyNames&&0!==Object.getOwnPropertyNames(t).length)return!1;var i=Object.getOwnPropertySymbols(t);if(1!==i.length||i[0]!==e)return!1;if(!Object.prototype.propertyIsEnumerable.call(t,e))return!1;if("function"==typeof Object.getOwnPropertyDescriptor){var n=Object.getOwnPropertyDescriptor(t,e);if(42!==n.value||!0!==n.enumerable)return!1}return!0}},{}],44:[function(t,e,r){r.read=function(t,e,r,i,n){var a,o,s=8*n-i-1,h=(1<<s)-1,l=h>>1,f=-7,u=r?n-1:0,c=r?-1:1,d=t[e+u];for(u+=c,a=d&(1<<-f)-1,d>>=-f,f+=s;f>0;a=256*a+t[e+u],u+=c,f-=8);for(o=a&(1<<-f)-1,a>>=-f,f+=i;f>0;o=256*o+t[e+u],u+=c,f-=8);if(0===a)a=1-l;else{if(a===h)return o?NaN:1/0*(d?-1:1);o+=Math.pow(2,i),a-=l}return(d?-1:1)*o*Math.pow(2,a-i)},r.write=function(t,e,r,i,n,a){var o,s,h,l=8*a-n-1,f=(1<<l)-1,u=f>>1,c=23===n?Math.pow(2,-24)-Math.pow(2,-77):0,d=i?0:a-1,p=i?1:-1,m=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(s=isNaN(e)?1:0,o=f):(o=Math.floor(Math.log(e)/Math.LN2),e*(h=Math.pow(2,-o))<1&&(o--,h*=2),(e+=o+u>=1?c/h:c*Math.pow(2,1-u))*h>=2&&(o++,h/=2),o+u>=f?(s=0,o=f):o+u>=1?(s=(e*h-1)*Math.pow(2,n),o+=u):(s=e*Math.pow(2,u-1)*Math.pow(2,n),o=0));n>=8;t[r+d]=255&s,d+=p,s/=256,n-=8);for(o=o<<n|s,l+=n;l>0;t[r+d]=255&o,d+=p,o/=256,l-=8);t[r+d-p]|=128*m}},{}],45:[function(t,e,r){"function"==typeof Object.create?e.exports=function(t,e){e&&(t.super_=e,t.prototype=Object.create(e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}))}:e.exports=function(t,e){if(e){t.super_=e;var r=function(){};r.prototype=e.prototype,t.prototype=new r,t.prototype.constructor=t}}},{}],46:[function(t,e,r){"use strict";var i="function"==typeof Symbol&&"symbol"==typeof Symbol.toStringTag,n=Object.prototype.toString,a=function(t){return!(i&&t&&"object"==typeof t&&Symbol.toStringTag in t)&&"[object Arguments]"===n.call(t)},o=function(t){return!!a(t)||null!==t&&"object"==typeof t&&"number"==typeof t.length&&t.length>=0&&"[object Array]"!==n.call(t)&&"[object Function]"===n.call(t.callee)},s=function(){return a(arguments)}();a.isLegacyArguments=o,e.exports=s?a:o},{}],47:[function(t,e,r){"use strict";var i=Object.prototype.toString,n=Function.prototype.toString,a=/^\s*(?:function)?\*/,o="function"==typeof Symbol&&"symbol"==typeof Symbol.toStringTag,s=Object.getPrototypeOf,h=function(){if(!o)return!1;try{return Function("return function*() {}")()}catch(t){}}(),l=h?s(h):{};e.exports=function(t){return"function"==typeof t&&(!!a.test(n.call(t))||(o?s(t)===l:"[object GeneratorFunction]"===i.call(t)))}},{}],48:[function(t,e,i){(function(r){(function(){"use strict";var i=t("foreach"),n=t("available-typed-arrays"),a=t("es-abstract/helpers/callBound"),o=a("Object.prototype.toString"),s=t("has-symbols")()&&"symbol"==typeof Symbol.toStringTag,h=n(),l=a("Array.prototype.indexOf",!0)||function(t,e){for(var r=0;r<t.length;r+=1)if(t[r]===e)return r;return-1},f=a("String.prototype.slice"),u={},c=t("es-abstract/helpers/getOwnPropertyDescriptor"),d=Object.getPrototypeOf;s&&c&&d&&i(h,(function(t){var e=new r[t];if(!(Symbol.toStringTag in e))throw new EvalError("this engine has support for Symbol.toStringTag, but "+t+" does not have the property! Please report this.");var i=d(e),n=c(i,Symbol.toStringTag);if(!n){var a=d(i);n=c(a,Symbol.toStringTag)}u[t]=n.get}));e.exports=function(t){if(!t||"object"!=typeof t)return!1;if(!s){var e=f(o(t),8,-1);return l(h,e)>-1}return!!c&&function(t){var e=!1;return i(u,(function(r,i){if(!e)try{e=r.call(t)===i}catch(t){}})),e}(t)}}).call(this)}).call(this,void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"available-typed-arrays":27,"es-abstract/helpers/callBound":36,"es-abstract/helpers/getOwnPropertyDescriptor":37,foreach:39,"has-symbols":42}],49:[function(t,e,r){"use strict";var i="undefined"!=typeof Uint8Array&&"undefined"!=typeof Uint16Array&&"undefined"!=typeof Int32Array;function n(t,e){return Object.prototype.hasOwnProperty.call(t,e)}r.assign=function(t){for(var e=Array.prototype.slice.call(arguments,1);e.length;){var r=e.shift();if(r){if("object"!=typeof r)throw new TypeError(r+"must be non-object");for(var i in r)n(r,i)&&(t[i]=r[i])}}return t},r.shrinkBuf=function(t,e){return t.length===e?t:t.subarray?t.subarray(0,e):(t.length=e,t)};var a={arraySet:function(t,e,r,i,n){if(e.subarray&&t.subarray)t.set(e.subarray(r,r+i),n);else for(var a=0;a<i;a++)t[n+a]=e[r+a]},flattenChunks:function(t){var e,r,i,n,a,o;for(i=0,e=0,r=t.length;e<r;e++)i+=t[e].length;for(o=new Uint8Array(i),n=0,e=0,r=t.length;e<r;e++)a=t[e],o.set(a,n),n+=a.length;return o}},o={arraySet:function(t,e,r,i,n){for(var a=0;a<i;a++)t[n+a]=e[r+a]},flattenChunks:function(t){return[].concat.apply([],t)}};r.setTyped=function(t){t?(r.Buf8=Uint8Array,r.Buf16=Uint16Array,r.Buf32=Int32Array,r.assign(r,a)):(r.Buf8=Array,r.Buf16=Array,r.Buf32=Array,r.assign(r,o))},r.setTyped(i)},{}],50:[function(t,e,r){"use strict";e.exports=function(t,e,r,i){for(var n=65535&t|0,a=t>>>16&65535|0,o=0;0!==r;){r-=o=r>2e3?2e3:r;do{a=a+(n=n+e[i++]|0)|0}while(--o);n%=65521,a%=65521}return n|a<<16|0}},{}],51:[function(t,e,r){"use strict";e.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8}},{}],52:[function(t,e,r){"use strict";var i=function(){for(var t,e=[],r=0;r<256;r++){t=r;for(var i=0;i<8;i++)t=1&t?3988292384^t>>>1:t>>>1;e[r]=t}return e}();e.exports=function(t,e,r,n){var a=i,o=n+r;t^=-1;for(var s=n;s<o;s++)t=t>>>8^a[255&(t^e[s])];return-1^t}},{}],53:[function(t,e,r){"use strict";var i,n=t("../utils/common"),a=t("./trees"),o=t("./adler32"),s=t("./crc32"),h=t("./messages"),l=0,f=1,u=3,c=4,d=5,p=0,m=1,g=-2,b=-3,_=-5,y=-1,w=1,v=2,x=3,E=4,k=0,S=2,M=8,A=9,I=15,B=8,T=286,R=30,P=19,O=2*T+1,L=15,C=3,U=258,z=U+C+1,D=32,N=42,F=69,j=73,G=91,H=103,W=113,q=666,Z=1,Y=2,V=3,X=4,J=3;function Q(t,e){return t.msg=h[e],e}function K(t){return(t<<1)-(t>4?9:0)}function $(t){for(var e=t.length;--e>=0;)t[e]=0}function tt(t){var e=t.state,r=e.pending;r>t.avail_out&&(r=t.avail_out),0!==r&&(n.arraySet(t.output,e.pending_buf,e.pending_out,r,t.next_out),t.next_out+=r,e.pending_out+=r,t.total_out+=r,t.avail_out-=r,e.pending-=r,0===e.pending&&(e.pending_out=0))}function et(t,e){a._tr_flush_block(t,t.block_start>=0?t.block_start:-1,t.strstart-t.block_start,e),t.block_start=t.strstart,tt(t.strm)}function rt(t,e){t.pending_buf[t.pending++]=e}function it(t,e){t.pending_buf[t.pending++]=e>>>8&255,t.pending_buf[t.pending++]=255&e}function nt(t,e){var r,i,n=t.max_chain_length,a=t.strstart,o=t.prev_length,s=t.nice_match,h=t.strstart>t.w_size-z?t.strstart-(t.w_size-z):0,l=t.window,f=t.w_mask,u=t.prev,c=t.strstart+U,d=l[a+o-1],p=l[a+o];t.prev_length>=t.good_match&&(n>>=2),s>t.lookahead&&(s=t.lookahead);do{if(l[(r=e)+o]===p&&l[r+o-1]===d&&l[r]===l[a]&&l[++r]===l[a+1]){a+=2,r++;do{}while(l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&l[++a]===l[++r]&&a<c);if(i=U-(c-a),a=c-U,i>o){if(t.match_start=e,o=i,i>=s)break;d=l[a+o-1],p=l[a+o]}}}while((e=u[e&f])>h&&0!=--n);return o<=t.lookahead?o:t.lookahead}function at(t){var e,r,i,a,h,l,f,u,c,d,p=t.w_size;do{if(a=t.window_size-t.lookahead-t.strstart,t.strstart>=p+(p-z)){n.arraySet(t.window,t.window,p,p,0),t.match_start-=p,t.strstart-=p,t.block_start-=p,e=r=t.hash_size;do{i=t.head[--e],t.head[e]=i>=p?i-p:0}while(--r);e=r=p;do{i=t.prev[--e],t.prev[e]=i>=p?i-p:0}while(--r);a+=p}if(0===t.strm.avail_in)break;if(l=t.strm,f=t.window,u=t.strstart+t.lookahead,c=a,d=void 0,(d=l.avail_in)>c&&(d=c),r=0===d?0:(l.avail_in-=d,n.arraySet(f,l.input,l.next_in,d,u),1===l.state.wrap?l.adler=o(l.adler,f,d,u):2===l.state.wrap&&(l.adler=s(l.adler,f,d,u)),l.next_in+=d,l.total_in+=d,d),t.lookahead+=r,t.lookahead+t.insert>=C)for(h=t.strstart-t.insert,t.ins_h=t.window[h],t.ins_h=(t.ins_h<<t.hash_shift^t.window[h+1])&t.hash_mask;t.insert&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[h+C-1])&t.hash_mask,t.prev[h&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=h,h++,t.insert--,!(t.lookahead+t.insert<C)););}while(t.lookahead<z&&0!==t.strm.avail_in)}function ot(t,e){for(var r,i;;){if(t.lookahead<z){if(at(t),t.lookahead<z&&e===l)return Z;if(0===t.lookahead)break}if(r=0,t.lookahead>=C&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+C-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),0!==r&&t.strstart-r<=t.w_size-z&&(t.match_length=nt(t,r)),t.match_length>=C)if(i=a._tr_tally(t,t.strstart-t.match_start,t.match_length-C),t.lookahead-=t.match_length,t.match_length<=t.max_lazy_match&&t.lookahead>=C){t.match_length--;do{t.strstart++,t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+C-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart}while(0!=--t.match_length);t.strstart++}else t.strstart+=t.match_length,t.match_length=0,t.ins_h=t.window[t.strstart],t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+1])&t.hash_mask;else i=a._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++;if(i&&(et(t,!1),0===t.strm.avail_out))return Z}return t.insert=t.strstart<C-1?t.strstart:C-1,e===c?(et(t,!0),0===t.strm.avail_out?V:X):t.last_lit&&(et(t,!1),0===t.strm.avail_out)?Z:Y}function st(t,e){for(var r,i,n;;){if(t.lookahead<z){if(at(t),t.lookahead<z&&e===l)return Z;if(0===t.lookahead)break}if(r=0,t.lookahead>=C&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+C-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart),t.prev_length=t.match_length,t.prev_match=t.match_start,t.match_length=C-1,0!==r&&t.prev_length<t.max_lazy_match&&t.strstart-r<=t.w_size-z&&(t.match_length=nt(t,r),t.match_length<=5&&(t.strategy===w||t.match_length===C&&t.strstart-t.match_start>4096)&&(t.match_length=C-1)),t.prev_length>=C&&t.match_length<=t.prev_length){n=t.strstart+t.lookahead-C,i=a._tr_tally(t,t.strstart-1-t.prev_match,t.prev_length-C),t.lookahead-=t.prev_length-1,t.prev_length-=2;do{++t.strstart<=n&&(t.ins_h=(t.ins_h<<t.hash_shift^t.window[t.strstart+C-1])&t.hash_mask,r=t.prev[t.strstart&t.w_mask]=t.head[t.ins_h],t.head[t.ins_h]=t.strstart)}while(0!=--t.prev_length);if(t.match_available=0,t.match_length=C-1,t.strstart++,i&&(et(t,!1),0===t.strm.avail_out))return Z}else if(t.match_available){if((i=a._tr_tally(t,0,t.window[t.strstart-1]))&&et(t,!1),t.strstart++,t.lookahead--,0===t.strm.avail_out)return Z}else t.match_available=1,t.strstart++,t.lookahead--}return t.match_available&&(i=a._tr_tally(t,0,t.window[t.strstart-1]),t.match_available=0),t.insert=t.strstart<C-1?t.strstart:C-1,e===c?(et(t,!0),0===t.strm.avail_out?V:X):t.last_lit&&(et(t,!1),0===t.strm.avail_out)?Z:Y}function ht(t,e,r,i,n){this.good_length=t,this.max_lazy=e,this.nice_length=r,this.max_chain=i,this.func=n}function lt(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=M,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new n.Buf16(2*O),this.dyn_dtree=new n.Buf16(2*(2*R+1)),this.bl_tree=new n.Buf16(2*(2*P+1)),$(this.dyn_ltree),$(this.dyn_dtree),$(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new n.Buf16(L+1),this.heap=new n.Buf16(2*T+1),$(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new n.Buf16(2*T+1),$(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function ft(t){var e;return t&&t.state?(t.total_in=t.total_out=0,t.data_type=S,(e=t.state).pending=0,e.pending_out=0,e.wrap<0&&(e.wrap=-e.wrap),e.status=e.wrap?N:W,t.adler=2===e.wrap?0:1,e.last_flush=l,a._tr_init(e),p):Q(t,g)}function ut(t){var e,r=ft(t);return r===p&&((e=t.state).window_size=2*e.w_size,$(e.head),e.max_lazy_match=i[e.level].max_lazy,e.good_match=i[e.level].good_length,e.nice_match=i[e.level].nice_length,e.max_chain_length=i[e.level].max_chain,e.strstart=0,e.block_start=0,e.lookahead=0,e.insert=0,e.match_length=e.prev_length=C-1,e.match_available=0,e.ins_h=0),r}function ct(t,e,r,i,a,o){if(!t)return g;var s=1;if(e===y&&(e=6),i<0?(s=0,i=-i):i>15&&(s=2,i-=16),a<1||a>A||r!==M||i<8||i>15||e<0||e>9||o<0||o>E)return Q(t,g);8===i&&(i=9);var h=new lt;return t.state=h,h.strm=t,h.wrap=s,h.gzhead=null,h.w_bits=i,h.w_size=1<<h.w_bits,h.w_mask=h.w_size-1,h.hash_bits=a+7,h.hash_size=1<<h.hash_bits,h.hash_mask=h.hash_size-1,h.hash_shift=~~((h.hash_bits+C-1)/C),h.window=new n.Buf8(2*h.w_size),h.head=new n.Buf16(h.hash_size),h.prev=new n.Buf16(h.w_size),h.lit_bufsize=1<<a+6,h.pending_buf_size=4*h.lit_bufsize,h.pending_buf=new n.Buf8(h.pending_buf_size),h.d_buf=1*h.lit_bufsize,h.l_buf=3*h.lit_bufsize,h.level=e,h.strategy=o,h.method=r,ut(t)}i=[new ht(0,0,0,0,(function(t,e){var r=65535;for(r>t.pending_buf_size-5&&(r=t.pending_buf_size-5);;){if(t.lookahead<=1){if(at(t),0===t.lookahead&&e===l)return Z;if(0===t.lookahead)break}t.strstart+=t.lookahead,t.lookahead=0;var i=t.block_start+r;if((0===t.strstart||t.strstart>=i)&&(t.lookahead=t.strstart-i,t.strstart=i,et(t,!1),0===t.strm.avail_out))return Z;if(t.strstart-t.block_start>=t.w_size-z&&(et(t,!1),0===t.strm.avail_out))return Z}return t.insert=0,e===c?(et(t,!0),0===t.strm.avail_out?V:X):(t.strstart>t.block_start&&(et(t,!1),t.strm.avail_out),Z)})),new ht(4,4,8,4,ot),new ht(4,5,16,8,ot),new ht(4,6,32,32,ot),new ht(4,4,16,16,st),new ht(8,16,32,32,st),new ht(8,16,128,128,st),new ht(8,32,128,256,st),new ht(32,128,258,1024,st),new ht(32,258,258,4096,st)],r.deflateInit=function(t,e){return ct(t,e,M,I,B,k)},r.deflateInit2=ct,r.deflateReset=ut,r.deflateResetKeep=ft,r.deflateSetHeader=function(t,e){return t&&t.state?2!==t.state.wrap?g:(t.state.gzhead=e,p):g},r.deflate=function(t,e){var r,n,o,h;if(!t||!t.state||e>d||e<0)return t?Q(t,g):g;if(n=t.state,!t.output||!t.input&&0!==t.avail_in||n.status===q&&e!==c)return Q(t,0===t.avail_out?_:g);if(n.strm=t,r=n.last_flush,n.last_flush=e,n.status===N)if(2===n.wrap)t.adler=0,rt(n,31),rt(n,139),rt(n,8),n.gzhead?(rt(n,(n.gzhead.text?1:0)+(n.gzhead.hcrc?2:0)+(n.gzhead.extra?4:0)+(n.gzhead.name?8:0)+(n.gzhead.comment?16:0)),rt(n,255&n.gzhead.time),rt(n,n.gzhead.time>>8&255),rt(n,n.gzhead.time>>16&255),rt(n,n.gzhead.time>>24&255),rt(n,9===n.level?2:n.strategy>=v||n.level<2?4:0),rt(n,255&n.gzhead.os),n.gzhead.extra&&n.gzhead.extra.length&&(rt(n,255&n.gzhead.extra.length),rt(n,n.gzhead.extra.length>>8&255)),n.gzhead.hcrc&&(t.adler=s(t.adler,n.pending_buf,n.pending,0)),n.gzindex=0,n.status=F):(rt(n,0),rt(n,0),rt(n,0),rt(n,0),rt(n,0),rt(n,9===n.level?2:n.strategy>=v||n.level<2?4:0),rt(n,J),n.status=W);else{var b=M+(n.w_bits-8<<4)<<8;b|=(n.strategy>=v||n.level<2?0:n.level<6?1:6===n.level?2:3)<<6,0!==n.strstart&&(b|=D),b+=31-b%31,n.status=W,it(n,b),0!==n.strstart&&(it(n,t.adler>>>16),it(n,65535&t.adler)),t.adler=1}if(n.status===F)if(n.gzhead.extra){for(o=n.pending;n.gzindex<(65535&n.gzhead.extra.length)&&(n.pending!==n.pending_buf_size||(n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),tt(t),o=n.pending,n.pending!==n.pending_buf_size));)rt(n,255&n.gzhead.extra[n.gzindex]),n.gzindex++;n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),n.gzindex===n.gzhead.extra.length&&(n.gzindex=0,n.status=j)}else n.status=j;if(n.status===j)if(n.gzhead.name){o=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),tt(t),o=n.pending,n.pending===n.pending_buf_size)){h=1;break}h=n.gzindex<n.gzhead.name.length?255&n.gzhead.name.charCodeAt(n.gzindex++):0,rt(n,h)}while(0!==h);n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),0===h&&(n.gzindex=0,n.status=G)}else n.status=G;if(n.status===G)if(n.gzhead.comment){o=n.pending;do{if(n.pending===n.pending_buf_size&&(n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),tt(t),o=n.pending,n.pending===n.pending_buf_size)){h=1;break}h=n.gzindex<n.gzhead.comment.length?255&n.gzhead.comment.charCodeAt(n.gzindex++):0,rt(n,h)}while(0!==h);n.gzhead.hcrc&&n.pending>o&&(t.adler=s(t.adler,n.pending_buf,n.pending-o,o)),0===h&&(n.status=H)}else n.status=H;if(n.status===H&&(n.gzhead.hcrc?(n.pending+2>n.pending_buf_size&&tt(t),n.pending+2<=n.pending_buf_size&&(rt(n,255&t.adler),rt(n,t.adler>>8&255),t.adler=0,n.status=W)):n.status=W),0!==n.pending){if(tt(t),0===t.avail_out)return n.last_flush=-1,p}else if(0===t.avail_in&&K(e)<=K(r)&&e!==c)return Q(t,_);if(n.status===q&&0!==t.avail_in)return Q(t,_);if(0!==t.avail_in||0!==n.lookahead||e!==l&&n.status!==q){var y=n.strategy===v?function(t,e){for(var r;;){if(0===t.lookahead&&(at(t),0===t.lookahead)){if(e===l)return Z;break}if(t.match_length=0,r=a._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++,r&&(et(t,!1),0===t.strm.avail_out))return Z}return t.insert=0,e===c?(et(t,!0),0===t.strm.avail_out?V:X):t.last_lit&&(et(t,!1),0===t.strm.avail_out)?Z:Y}(n,e):n.strategy===x?function(t,e){for(var r,i,n,o,s=t.window;;){if(t.lookahead<=U){if(at(t),t.lookahead<=U&&e===l)return Z;if(0===t.lookahead)break}if(t.match_length=0,t.lookahead>=C&&t.strstart>0&&(i=s[n=t.strstart-1])===s[++n]&&i===s[++n]&&i===s[++n]){o=t.strstart+U;do{}while(i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&i===s[++n]&&n<o);t.match_length=U-(o-n),t.match_length>t.lookahead&&(t.match_length=t.lookahead)}if(t.match_length>=C?(r=a._tr_tally(t,1,t.match_length-C),t.lookahead-=t.match_length,t.strstart+=t.match_length,t.match_length=0):(r=a._tr_tally(t,0,t.window[t.strstart]),t.lookahead--,t.strstart++),r&&(et(t,!1),0===t.strm.avail_out))return Z}return t.insert=0,e===c?(et(t,!0),0===t.strm.avail_out?V:X):t.last_lit&&(et(t,!1),0===t.strm.avail_out)?Z:Y}(n,e):i[n.level].func(n,e);if(y!==V&&y!==X||(n.status=q),y===Z||y===V)return 0===t.avail_out&&(n.last_flush=-1),p;if(y===Y&&(e===f?a._tr_align(n):e!==d&&(a._tr_stored_block(n,0,0,!1),e===u&&($(n.head),0===n.lookahead&&(n.strstart=0,n.block_start=0,n.insert=0))),tt(t),0===t.avail_out))return n.last_flush=-1,p}return e!==c?p:n.wrap<=0?m:(2===n.wrap?(rt(n,255&t.adler),rt(n,t.adler>>8&255),rt(n,t.adler>>16&255),rt(n,t.adler>>24&255),rt(n,255&t.total_in),rt(n,t.total_in>>8&255),rt(n,t.total_in>>16&255),rt(n,t.total_in>>24&255)):(it(n,t.adler>>>16),it(n,65535&t.adler)),tt(t),n.wrap>0&&(n.wrap=-n.wrap),0!==n.pending?p:m)},r.deflateEnd=function(t){var e;return t&&t.state?(e=t.state.status)!==N&&e!==F&&e!==j&&e!==G&&e!==H&&e!==W&&e!==q?Q(t,g):(t.state=null,e===W?Q(t,b):p):g},r.deflateSetDictionary=function(t,e){var r,i,a,s,h,l,f,u,c=e.length;if(!t||!t.state)return g;if(2===(s=(r=t.state).wrap)||1===s&&r.status!==N||r.lookahead)return g;for(1===s&&(t.adler=o(t.adler,e,c,0)),r.wrap=0,c>=r.w_size&&(0===s&&($(r.head),r.strstart=0,r.block_start=0,r.insert=0),u=new n.Buf8(r.w_size),n.arraySet(u,e,c-r.w_size,r.w_size,0),e=u,c=r.w_size),h=t.avail_in,l=t.next_in,f=t.input,t.avail_in=c,t.next_in=0,t.input=e,at(r);r.lookahead>=C;){i=r.strstart,a=r.lookahead-(C-1);do{r.ins_h=(r.ins_h<<r.hash_shift^r.window[i+C-1])&r.hash_mask,r.prev[i&r.w_mask]=r.head[r.ins_h],r.head[r.ins_h]=i,i++}while(--a);r.strstart=i,r.lookahead=C-1,at(r)}return r.strstart+=r.lookahead,r.block_start=r.strstart,r.insert=r.lookahead,r.lookahead=0,r.match_length=r.prev_length=C-1,r.match_available=0,t.next_in=l,t.input=f,t.avail_in=h,r.wrap=s,p},r.deflateInfo="pako deflate (from Nodeca project)"},{"../utils/common":49,"./adler32":50,"./crc32":52,"./messages":57,"./trees":58}],54:[function(t,e,r){"use strict";e.exports=function(t,e){var r,i,n,a,o,s,h,l,f,u,c,d,p,m,g,b,_,y,w,v,x,E,k,S,M;r=t.state,i=t.next_in,S=t.input,n=i+(t.avail_in-5),a=t.next_out,M=t.output,o=a-(e-t.avail_out),s=a+(t.avail_out-257),h=r.dmax,l=r.wsize,f=r.whave,u=r.wnext,c=r.window,d=r.hold,p=r.bits,m=r.lencode,g=r.distcode,b=(1<<r.lenbits)-1,_=(1<<r.distbits)-1;t:do{p<15&&(d+=S[i++]<<p,p+=8,d+=S[i++]<<p,p+=8),y=m[d&b];e:for(;;){if(d>>>=w=y>>>24,p-=w,0==(w=y>>>16&255))M[a++]=65535&y;else{if(!(16&w)){if(0==(64&w)){y=m[(65535&y)+(d&(1<<w)-1)];continue e}if(32&w){r.mode=12;break t}t.msg="invalid literal/length code",r.mode=30;break t}v=65535&y,(w&=15)&&(p<w&&(d+=S[i++]<<p,p+=8),v+=d&(1<<w)-1,d>>>=w,p-=w),p<15&&(d+=S[i++]<<p,p+=8,d+=S[i++]<<p,p+=8),y=g[d&_];r:for(;;){if(d>>>=w=y>>>24,p-=w,!(16&(w=y>>>16&255))){if(0==(64&w)){y=g[(65535&y)+(d&(1<<w)-1)];continue r}t.msg="invalid distance code",r.mode=30;break t}if(x=65535&y,p<(w&=15)&&(d+=S[i++]<<p,(p+=8)<w&&(d+=S[i++]<<p,p+=8)),(x+=d&(1<<w)-1)>h){t.msg="invalid distance too far back",r.mode=30;break t}if(d>>>=w,p-=w,x>(w=a-o)){if((w=x-w)>f&&r.sane){t.msg="invalid distance too far back",r.mode=30;break t}if(E=0,k=c,0===u){if(E+=l-w,w<v){v-=w;do{M[a++]=c[E++]}while(--w);E=a-x,k=M}}else if(u<w){if(E+=l+u-w,(w-=u)<v){v-=w;do{M[a++]=c[E++]}while(--w);if(E=0,u<v){v-=w=u;do{M[a++]=c[E++]}while(--w);E=a-x,k=M}}}else if(E+=u-w,w<v){v-=w;do{M[a++]=c[E++]}while(--w);E=a-x,k=M}for(;v>2;)M[a++]=k[E++],M[a++]=k[E++],M[a++]=k[E++],v-=3;v&&(M[a++]=k[E++],v>1&&(M[a++]=k[E++]))}else{E=a-x;do{M[a++]=M[E++],M[a++]=M[E++],M[a++]=M[E++],v-=3}while(v>2);v&&(M[a++]=M[E++],v>1&&(M[a++]=M[E++]))}break}}break}}while(i<n&&a<s);i-=v=p>>3,d&=(1<<(p-=v<<3))-1,t.next_in=i,t.next_out=a,t.avail_in=i<n?n-i+5:5-(i-n),t.avail_out=a<s?s-a+257:257-(a-s),r.hold=d,r.bits=p}},{}],55:[function(t,e,r){"use strict";var i=t("../utils/common"),n=t("./adler32"),a=t("./crc32"),o=t("./inffast"),s=t("./inftrees"),h=0,l=1,f=2,u=4,c=5,d=6,p=0,m=1,g=2,b=-2,_=-3,y=-4,w=-5,v=8,x=1,E=2,k=3,S=4,M=5,A=6,I=7,B=8,T=9,R=10,P=11,O=12,L=13,C=14,U=15,z=16,D=17,N=18,F=19,j=20,G=21,H=22,W=23,q=24,Z=25,Y=26,V=27,X=28,J=29,Q=30,K=31,$=852,tt=592,et=15;function rt(t){return(t>>>24&255)+(t>>>8&65280)+((65280&t)<<8)+((255&t)<<24)}function it(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new i.Buf16(320),this.work=new i.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}function nt(t){var e;return t&&t.state?(e=t.state,t.total_in=t.total_out=e.total=0,t.msg="",e.wrap&&(t.adler=1&e.wrap),e.mode=x,e.last=0,e.havedict=0,e.dmax=32768,e.head=null,e.hold=0,e.bits=0,e.lencode=e.lendyn=new i.Buf32($),e.distcode=e.distdyn=new i.Buf32(tt),e.sane=1,e.back=-1,p):b}function at(t){var e;return t&&t.state?((e=t.state).wsize=0,e.whave=0,e.wnext=0,nt(t)):b}function ot(t,e){var r,i;return t&&t.state?(i=t.state,e<0?(r=0,e=-e):(r=1+(e>>4),e<48&&(e&=15)),e&&(e<8||e>15)?b:(null!==i.window&&i.wbits!==e&&(i.window=null),i.wrap=r,i.wbits=e,at(t))):b}function st(t,e){var r,i;return t?(i=new it,t.state=i,i.window=null,(r=ot(t,e))!==p&&(t.state=null),r):b}var ht,lt,ft=!0;function ut(t){if(ft){var e;for(ht=new i.Buf32(512),lt=new i.Buf32(32),e=0;e<144;)t.lens[e++]=8;for(;e<256;)t.lens[e++]=9;for(;e<280;)t.lens[e++]=7;for(;e<288;)t.lens[e++]=8;for(s(l,t.lens,0,288,ht,0,t.work,{bits:9}),e=0;e<32;)t.lens[e++]=5;s(f,t.lens,0,32,lt,0,t.work,{bits:5}),ft=!1}t.lencode=ht,t.lenbits=9,t.distcode=lt,t.distbits=5}function ct(t,e,r,n){var a,o=t.state;return null===o.window&&(o.wsize=1<<o.wbits,o.wnext=0,o.whave=0,o.window=new i.Buf8(o.wsize)),n>=o.wsize?(i.arraySet(o.window,e,r-o.wsize,o.wsize,0),o.wnext=0,o.whave=o.wsize):((a=o.wsize-o.wnext)>n&&(a=n),i.arraySet(o.window,e,r-n,a,o.wnext),(n-=a)?(i.arraySet(o.window,e,r-n,n,0),o.wnext=n,o.whave=o.wsize):(o.wnext+=a,o.wnext===o.wsize&&(o.wnext=0),o.whave<o.wsize&&(o.whave+=a))),0}r.inflateReset=at,r.inflateReset2=ot,r.inflateResetKeep=nt,r.inflateInit=function(t){return st(t,et)},r.inflateInit2=st,r.inflate=function(t,e){var r,$,tt,et,it,nt,at,ot,st,ht,lt,ft,dt,pt,mt,gt,bt,_t,yt,wt,vt,xt,Et,kt,St=0,Mt=new i.Buf8(4),At=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!t||!t.state||!t.output||!t.input&&0!==t.avail_in)return b;(r=t.state).mode===O&&(r.mode=L),it=t.next_out,tt=t.output,at=t.avail_out,et=t.next_in,$=t.input,nt=t.avail_in,ot=r.hold,st=r.bits,ht=nt,lt=at,xt=p;t:for(;;)switch(r.mode){case x:if(0===r.wrap){r.mode=L;break}for(;st<16;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(2&r.wrap&&35615===ot){r.check=0,Mt[0]=255&ot,Mt[1]=ot>>>8&255,r.check=a(r.check,Mt,2,0),ot=0,st=0,r.mode=E;break}if(r.flags=0,r.head&&(r.head.done=!1),!(1&r.wrap)||(((255&ot)<<8)+(ot>>8))%31){t.msg="incorrect header check",r.mode=Q;break}if((15&ot)!==v){t.msg="unknown compression method",r.mode=Q;break}if(st-=4,vt=8+(15&(ot>>>=4)),0===r.wbits)r.wbits=vt;else if(vt>r.wbits){t.msg="invalid window size",r.mode=Q;break}r.dmax=1<<vt,t.adler=r.check=1,r.mode=512&ot?R:O,ot=0,st=0;break;case E:for(;st<16;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(r.flags=ot,(255&r.flags)!==v){t.msg="unknown compression method",r.mode=Q;break}if(57344&r.flags){t.msg="unknown header flags set",r.mode=Q;break}r.head&&(r.head.text=ot>>8&1),512&r.flags&&(Mt[0]=255&ot,Mt[1]=ot>>>8&255,r.check=a(r.check,Mt,2,0)),ot=0,st=0,r.mode=k;case k:for(;st<32;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}r.head&&(r.head.time=ot),512&r.flags&&(Mt[0]=255&ot,Mt[1]=ot>>>8&255,Mt[2]=ot>>>16&255,Mt[3]=ot>>>24&255,r.check=a(r.check,Mt,4,0)),ot=0,st=0,r.mode=S;case S:for(;st<16;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}r.head&&(r.head.xflags=255&ot,r.head.os=ot>>8),512&r.flags&&(Mt[0]=255&ot,Mt[1]=ot>>>8&255,r.check=a(r.check,Mt,2,0)),ot=0,st=0,r.mode=M;case M:if(1024&r.flags){for(;st<16;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}r.length=ot,r.head&&(r.head.extra_len=ot),512&r.flags&&(Mt[0]=255&ot,Mt[1]=ot>>>8&255,r.check=a(r.check,Mt,2,0)),ot=0,st=0}else r.head&&(r.head.extra=null);r.mode=A;case A:if(1024&r.flags&&((ft=r.length)>nt&&(ft=nt),ft&&(r.head&&(vt=r.head.extra_len-r.length,r.head.extra||(r.head.extra=new Array(r.head.extra_len)),i.arraySet(r.head.extra,$,et,ft,vt)),512&r.flags&&(r.check=a(r.check,$,ft,et)),nt-=ft,et+=ft,r.length-=ft),r.length))break t;r.length=0,r.mode=I;case I:if(2048&r.flags){if(0===nt)break t;ft=0;do{vt=$[et+ft++],r.head&&vt&&r.length<65536&&(r.head.name+=String.fromCharCode(vt))}while(vt&&ft<nt);if(512&r.flags&&(r.check=a(r.check,$,ft,et)),nt-=ft,et+=ft,vt)break t}else r.head&&(r.head.name=null);r.length=0,r.mode=B;case B:if(4096&r.flags){if(0===nt)break t;ft=0;do{vt=$[et+ft++],r.head&&vt&&r.length<65536&&(r.head.comment+=String.fromCharCode(vt))}while(vt&&ft<nt);if(512&r.flags&&(r.check=a(r.check,$,ft,et)),nt-=ft,et+=ft,vt)break t}else r.head&&(r.head.comment=null);r.mode=T;case T:if(512&r.flags){for(;st<16;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(ot!==(65535&r.check)){t.msg="header crc mismatch",r.mode=Q;break}ot=0,st=0}r.head&&(r.head.hcrc=r.flags>>9&1,r.head.done=!0),t.adler=r.check=0,r.mode=O;break;case R:for(;st<32;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}t.adler=r.check=rt(ot),ot=0,st=0,r.mode=P;case P:if(0===r.havedict)return t.next_out=it,t.avail_out=at,t.next_in=et,t.avail_in=nt,r.hold=ot,r.bits=st,g;t.adler=r.check=1,r.mode=O;case O:if(e===c||e===d)break t;case L:if(r.last){ot>>>=7&st,st-=7&st,r.mode=V;break}for(;st<3;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}switch(r.last=1&ot,st-=1,3&(ot>>>=1)){case 0:r.mode=C;break;case 1:if(ut(r),r.mode=j,e===d){ot>>>=2,st-=2;break t}break;case 2:r.mode=D;break;case 3:t.msg="invalid block type",r.mode=Q}ot>>>=2,st-=2;break;case C:for(ot>>>=7&st,st-=7&st;st<32;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if((65535&ot)!=(ot>>>16^65535)){t.msg="invalid stored block lengths",r.mode=Q;break}if(r.length=65535&ot,ot=0,st=0,r.mode=U,e===d)break t;case U:r.mode=z;case z:if(ft=r.length){if(ft>nt&&(ft=nt),ft>at&&(ft=at),0===ft)break t;i.arraySet(tt,$,et,ft,it),nt-=ft,et+=ft,at-=ft,it+=ft,r.length-=ft;break}r.mode=O;break;case D:for(;st<14;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(r.nlen=257+(31&ot),ot>>>=5,st-=5,r.ndist=1+(31&ot),ot>>>=5,st-=5,r.ncode=4+(15&ot),ot>>>=4,st-=4,r.nlen>286||r.ndist>30){t.msg="too many length or distance symbols",r.mode=Q;break}r.have=0,r.mode=N;case N:for(;r.have<r.ncode;){for(;st<3;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}r.lens[At[r.have++]]=7&ot,ot>>>=3,st-=3}for(;r.have<19;)r.lens[At[r.have++]]=0;if(r.lencode=r.lendyn,r.lenbits=7,Et={bits:r.lenbits},xt=s(h,r.lens,0,19,r.lencode,0,r.work,Et),r.lenbits=Et.bits,xt){t.msg="invalid code lengths set",r.mode=Q;break}r.have=0,r.mode=F;case F:for(;r.have<r.nlen+r.ndist;){for(;gt=(St=r.lencode[ot&(1<<r.lenbits)-1])>>>16&255,bt=65535&St,!((mt=St>>>24)<=st);){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(bt<16)ot>>>=mt,st-=mt,r.lens[r.have++]=bt;else{if(16===bt){for(kt=mt+2;st<kt;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(ot>>>=mt,st-=mt,0===r.have){t.msg="invalid bit length repeat",r.mode=Q;break}vt=r.lens[r.have-1],ft=3+(3&ot),ot>>>=2,st-=2}else if(17===bt){for(kt=mt+3;st<kt;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}st-=mt,vt=0,ft=3+(7&(ot>>>=mt)),ot>>>=3,st-=3}else{for(kt=mt+7;st<kt;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}st-=mt,vt=0,ft=11+(127&(ot>>>=mt)),ot>>>=7,st-=7}if(r.have+ft>r.nlen+r.ndist){t.msg="invalid bit length repeat",r.mode=Q;break}for(;ft--;)r.lens[r.have++]=vt}}if(r.mode===Q)break;if(0===r.lens[256]){t.msg="invalid code -- missing end-of-block",r.mode=Q;break}if(r.lenbits=9,Et={bits:r.lenbits},xt=s(l,r.lens,0,r.nlen,r.lencode,0,r.work,Et),r.lenbits=Et.bits,xt){t.msg="invalid literal/lengths set",r.mode=Q;break}if(r.distbits=6,r.distcode=r.distdyn,Et={bits:r.distbits},xt=s(f,r.lens,r.nlen,r.ndist,r.distcode,0,r.work,Et),r.distbits=Et.bits,xt){t.msg="invalid distances set",r.mode=Q;break}if(r.mode=j,e===d)break t;case j:r.mode=G;case G:if(nt>=6&&at>=258){t.next_out=it,t.avail_out=at,t.next_in=et,t.avail_in=nt,r.hold=ot,r.bits=st,o(t,lt),it=t.next_out,tt=t.output,at=t.avail_out,et=t.next_in,$=t.input,nt=t.avail_in,ot=r.hold,st=r.bits,r.mode===O&&(r.back=-1);break}for(r.back=0;gt=(St=r.lencode[ot&(1<<r.lenbits)-1])>>>16&255,bt=65535&St,!((mt=St>>>24)<=st);){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(gt&&0==(240&gt)){for(_t=mt,yt=gt,wt=bt;gt=(St=r.lencode[wt+((ot&(1<<_t+yt)-1)>>_t)])>>>16&255,bt=65535&St,!(_t+(mt=St>>>24)<=st);){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}ot>>>=_t,st-=_t,r.back+=_t}if(ot>>>=mt,st-=mt,r.back+=mt,r.length=bt,0===gt){r.mode=Y;break}if(32&gt){r.back=-1,r.mode=O;break}if(64&gt){t.msg="invalid literal/length code",r.mode=Q;break}r.extra=15&gt,r.mode=H;case H:if(r.extra){for(kt=r.extra;st<kt;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}r.length+=ot&(1<<r.extra)-1,ot>>>=r.extra,st-=r.extra,r.back+=r.extra}r.was=r.length,r.mode=W;case W:for(;gt=(St=r.distcode[ot&(1<<r.distbits)-1])>>>16&255,bt=65535&St,!((mt=St>>>24)<=st);){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(0==(240&gt)){for(_t=mt,yt=gt,wt=bt;gt=(St=r.distcode[wt+((ot&(1<<_t+yt)-1)>>_t)])>>>16&255,bt=65535&St,!(_t+(mt=St>>>24)<=st);){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}ot>>>=_t,st-=_t,r.back+=_t}if(ot>>>=mt,st-=mt,r.back+=mt,64&gt){t.msg="invalid distance code",r.mode=Q;break}r.offset=bt,r.extra=15&gt,r.mode=q;case q:if(r.extra){for(kt=r.extra;st<kt;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}r.offset+=ot&(1<<r.extra)-1,ot>>>=r.extra,st-=r.extra,r.back+=r.extra}if(r.offset>r.dmax){t.msg="invalid distance too far back",r.mode=Q;break}r.mode=Z;case Z:if(0===at)break t;if(ft=lt-at,r.offset>ft){if((ft=r.offset-ft)>r.whave&&r.sane){t.msg="invalid distance too far back",r.mode=Q;break}ft>r.wnext?(ft-=r.wnext,dt=r.wsize-ft):dt=r.wnext-ft,ft>r.length&&(ft=r.length),pt=r.window}else pt=tt,dt=it-r.offset,ft=r.length;ft>at&&(ft=at),at-=ft,r.length-=ft;do{tt[it++]=pt[dt++]}while(--ft);0===r.length&&(r.mode=G);break;case Y:if(0===at)break t;tt[it++]=r.length,at--,r.mode=G;break;case V:if(r.wrap){for(;st<32;){if(0===nt)break t;nt--,ot|=$[et++]<<st,st+=8}if(lt-=at,t.total_out+=lt,r.total+=lt,lt&&(t.adler=r.check=r.flags?a(r.check,tt,lt,it-lt):n(r.check,tt,lt,it-lt)),lt=at,(r.flags?ot:rt(ot))!==r.check){t.msg="incorrect data check",r.mode=Q;break}ot=0,st=0}r.mode=X;case X:if(r.wrap&&r.flags){for(;st<32;){if(0===nt)break t;nt--,ot+=$[et++]<<st,st+=8}if(ot!==(4294967295&r.total)){t.msg="incorrect length check",r.mode=Q;break}ot=0,st=0}r.mode=J;case J:xt=m;break t;case Q:xt=_;break t;case K:return y;default:return b}return t.next_out=it,t.avail_out=at,t.next_in=et,t.avail_in=nt,r.hold=ot,r.bits=st,(r.wsize||lt!==t.avail_out&&r.mode<Q&&(r.mode<V||e!==u))&&ct(t,t.output,t.next_out,lt-t.avail_out)?(r.mode=K,y):(ht-=t.avail_in,lt-=t.avail_out,t.total_in+=ht,t.total_out+=lt,r.total+=lt,r.wrap&&lt&&(t.adler=r.check=r.flags?a(r.check,tt,lt,t.next_out-lt):n(r.check,tt,lt,t.next_out-lt)),t.data_type=r.bits+(r.last?64:0)+(r.mode===O?128:0)+(r.mode===j||r.mode===U?256:0),(0===ht&&0===lt||e===u)&&xt===p&&(xt=w),xt)},r.inflateEnd=function(t){if(!t||!t.state)return b;var e=t.state;return e.window&&(e.window=null),t.state=null,p},r.inflateGetHeader=function(t,e){var r;return t&&t.state?0==(2&(r=t.state).wrap)?b:(r.head=e,e.done=!1,p):b},r.inflateSetDictionary=function(t,e){var r,i=e.length;return t&&t.state?0!==(r=t.state).wrap&&r.mode!==P?b:r.mode===P&&n(1,e,i,0)!==r.check?_:ct(t,e,i,i)?(r.mode=K,y):(r.havedict=1,p):b},r.inflateInfo="pako inflate (from Nodeca project)"},{"../utils/common":49,"./adler32":50,"./crc32":52,"./inffast":54,"./inftrees":56}],56:[function(t,e,r){"use strict";var i=t("../utils/common"),n=15,a=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],o=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],s=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],h=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];e.exports=function(t,e,r,l,f,u,c,d){var p,m,g,b,_,y,w,v,x,E=d.bits,k=0,S=0,M=0,A=0,I=0,B=0,T=0,R=0,P=0,O=0,L=null,C=0,U=new i.Buf16(16),z=new i.Buf16(16),D=null,N=0;for(k=0;k<=n;k++)U[k]=0;for(S=0;S<l;S++)U[e[r+S]]++;for(I=E,A=n;A>=1&&0===U[A];A--);if(I>A&&(I=A),0===A)return f[u++]=20971520,f[u++]=20971520,d.bits=1,0;for(M=1;M<A&&0===U[M];M++);for(I<M&&(I=M),R=1,k=1;k<=n;k++)if(R<<=1,(R-=U[k])<0)return-1;if(R>0&&(0===t||1!==A))return-1;for(z[1]=0,k=1;k<n;k++)z[k+1]=z[k]+U[k];for(S=0;S<l;S++)0!==e[r+S]&&(c[z[e[r+S]]++]=S);if(0===t?(L=D=c,y=19):1===t?(L=a,C-=257,D=o,N-=257,y=256):(L=s,D=h,y=-1),O=0,S=0,k=M,_=u,B=I,T=0,g=-1,b=(P=1<<I)-1,1===t&&P>852||2===t&&P>592)return 1;for(;;){w=k-T,c[S]<y?(v=0,x=c[S]):c[S]>y?(v=D[N+c[S]],x=L[C+c[S]]):(v=96,x=0),p=1<<k-T,M=m=1<<B;do{f[_+(O>>T)+(m-=p)]=w<<24|v<<16|x|0}while(0!==m);for(p=1<<k-1;O&p;)p>>=1;if(0!==p?(O&=p-1,O+=p):O=0,S++,0==--U[k]){if(k===A)break;k=e[r+c[S]]}if(k>I&&(O&b)!==g){for(0===T&&(T=I),_+=M,R=1<<(B=k-T);B+T<A&&!((R-=U[B+T])<=0);)B++,R<<=1;if(P+=1<<B,1===t&&P>852||2===t&&P>592)return 1;f[g=O&b]=I<<24|B<<16|_-u|0}}return 0!==O&&(f[_+O]=k-T<<24|64<<16|0),d.bits=I,0}},{"../utils/common":49}],57:[function(t,e,r){"use strict";e.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"}},{}],58:[function(t,e,r){"use strict";var i=t("../utils/common"),n=4,a=0,o=1,s=2;function h(t){for(var e=t.length;--e>=0;)t[e]=0}var l=0,f=1,u=2,c=29,d=256,p=d+1+c,m=30,g=19,b=2*p+1,_=15,y=16,w=7,v=256,x=16,E=17,k=18,S=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],M=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],A=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],I=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],B=new Array(2*(p+2));h(B);var T=new Array(2*m);h(T);var R=new Array(512);h(R);var P=new Array(256);h(P);var O=new Array(c);h(O);var L,C,U,z=new Array(m);function D(t,e,r,i,n){this.static_tree=t,this.extra_bits=e,this.extra_base=r,this.elems=i,this.max_length=n,this.has_stree=t&&t.length}function N(t,e){this.dyn_tree=t,this.max_code=0,this.stat_desc=e}function F(t){return t<256?R[t]:R[256+(t>>>7)]}function j(t,e){t.pending_buf[t.pending++]=255&e,t.pending_buf[t.pending++]=e>>>8&255}function G(t,e,r){t.bi_valid>y-r?(t.bi_buf|=e<<t.bi_valid&65535,j(t,t.bi_buf),t.bi_buf=e>>y-t.bi_valid,t.bi_valid+=r-y):(t.bi_buf|=e<<t.bi_valid&65535,t.bi_valid+=r)}function H(t,e,r){G(t,r[2*e],r[2*e+1])}function W(t,e){var r=0;do{r|=1&t,t>>>=1,r<<=1}while(--e>0);return r>>>1}function q(t,e,r){var i,n,a=new Array(_+1),o=0;for(i=1;i<=_;i++)a[i]=o=o+r[i-1]<<1;for(n=0;n<=e;n++){var s=t[2*n+1];0!==s&&(t[2*n]=W(a[s]++,s))}}function Z(t){var e;for(e=0;e<p;e++)t.dyn_ltree[2*e]=0;for(e=0;e<m;e++)t.dyn_dtree[2*e]=0;for(e=0;e<g;e++)t.bl_tree[2*e]=0;t.dyn_ltree[2*v]=1,t.opt_len=t.static_len=0,t.last_lit=t.matches=0}function Y(t){t.bi_valid>8?j(t,t.bi_buf):t.bi_valid>0&&(t.pending_buf[t.pending++]=t.bi_buf),t.bi_buf=0,t.bi_valid=0}function V(t,e,r,i){var n=2*e,a=2*r;return t[n]<t[a]||t[n]===t[a]&&i[e]<=i[r]}function X(t,e,r){for(var i=t.heap[r],n=r<<1;n<=t.heap_len&&(n<t.heap_len&&V(e,t.heap[n+1],t.heap[n],t.depth)&&n++,!V(e,i,t.heap[n],t.depth));)t.heap[r]=t.heap[n],r=n,n<<=1;t.heap[r]=i}function J(t,e,r){var i,n,a,o,s=0;if(0!==t.last_lit)do{i=t.pending_buf[t.d_buf+2*s]<<8|t.pending_buf[t.d_buf+2*s+1],n=t.pending_buf[t.l_buf+s],s++,0===i?H(t,n,e):(H(t,(a=P[n])+d+1,e),0!==(o=S[a])&&G(t,n-=O[a],o),H(t,a=F(--i),r),0!==(o=M[a])&&G(t,i-=z[a],o))}while(s<t.last_lit);H(t,v,e)}function Q(t,e){var r,i,n,a=e.dyn_tree,o=e.stat_desc.static_tree,s=e.stat_desc.has_stree,h=e.stat_desc.elems,l=-1;for(t.heap_len=0,t.heap_max=b,r=0;r<h;r++)0!==a[2*r]?(t.heap[++t.heap_len]=l=r,t.depth[r]=0):a[2*r+1]=0;for(;t.heap_len<2;)a[2*(n=t.heap[++t.heap_len]=l<2?++l:0)]=1,t.depth[n]=0,t.opt_len--,s&&(t.static_len-=o[2*n+1]);for(e.max_code=l,r=t.heap_len>>1;r>=1;r--)X(t,a,r);n=h;do{r=t.heap[1],t.heap[1]=t.heap[t.heap_len--],X(t,a,1),i=t.heap[1],t.heap[--t.heap_max]=r,t.heap[--t.heap_max]=i,a[2*n]=a[2*r]+a[2*i],t.depth[n]=(t.depth[r]>=t.depth[i]?t.depth[r]:t.depth[i])+1,a[2*r+1]=a[2*i+1]=n,t.heap[1]=n++,X(t,a,1)}while(t.heap_len>=2);t.heap[--t.heap_max]=t.heap[1],function(t,e){var r,i,n,a,o,s,h=e.dyn_tree,l=e.max_code,f=e.stat_desc.static_tree,u=e.stat_desc.has_stree,c=e.stat_desc.extra_bits,d=e.stat_desc.extra_base,p=e.stat_desc.max_length,m=0;for(a=0;a<=_;a++)t.bl_count[a]=0;for(h[2*t.heap[t.heap_max]+1]=0,r=t.heap_max+1;r<b;r++)(a=h[2*h[2*(i=t.heap[r])+1]+1]+1)>p&&(a=p,m++),h[2*i+1]=a,i>l||(t.bl_count[a]++,o=0,i>=d&&(o=c[i-d]),s=h[2*i],t.opt_len+=s*(a+o),u&&(t.static_len+=s*(f[2*i+1]+o)));if(0!==m){do{for(a=p-1;0===t.bl_count[a];)a--;t.bl_count[a]--,t.bl_count[a+1]+=2,t.bl_count[p]--,m-=2}while(m>0);for(a=p;0!==a;a--)for(i=t.bl_count[a];0!==i;)(n=t.heap[--r])>l||(h[2*n+1]!==a&&(t.opt_len+=(a-h[2*n+1])*h[2*n],h[2*n+1]=a),i--)}}(t,e),q(a,l,t.bl_count)}function K(t,e,r){var i,n,a=-1,o=e[1],s=0,h=7,l=4;for(0===o&&(h=138,l=3),e[2*(r+1)+1]=65535,i=0;i<=r;i++)n=o,o=e[2*(i+1)+1],++s<h&&n===o||(s<l?t.bl_tree[2*n]+=s:0!==n?(n!==a&&t.bl_tree[2*n]++,t.bl_tree[2*x]++):s<=10?t.bl_tree[2*E]++:t.bl_tree[2*k]++,s=0,a=n,0===o?(h=138,l=3):n===o?(h=6,l=3):(h=7,l=4))}function $(t,e,r){var i,n,a=-1,o=e[1],s=0,h=7,l=4;for(0===o&&(h=138,l=3),i=0;i<=r;i++)if(n=o,o=e[2*(i+1)+1],!(++s<h&&n===o)){if(s<l)do{H(t,n,t.bl_tree)}while(0!=--s);else 0!==n?(n!==a&&(H(t,n,t.bl_tree),s--),H(t,x,t.bl_tree),G(t,s-3,2)):s<=10?(H(t,E,t.bl_tree),G(t,s-3,3)):(H(t,k,t.bl_tree),G(t,s-11,7));s=0,a=n,0===o?(h=138,l=3):n===o?(h=6,l=3):(h=7,l=4)}}h(z);var tt=!1;function et(t,e,r,n){G(t,(l<<1)+(n?1:0),3),function(t,e,r,n){Y(t),n&&(j(t,r),j(t,~r)),i.arraySet(t.pending_buf,t.window,e,r,t.pending),t.pending+=r}(t,e,r,!0)}r._tr_init=function(t){tt||(function(){var t,e,r,i,n,a=new Array(_+1);for(r=0,i=0;i<c-1;i++)for(O[i]=r,t=0;t<1<<S[i];t++)P[r++]=i;for(P[r-1]=i,n=0,i=0;i<16;i++)for(z[i]=n,t=0;t<1<<M[i];t++)R[n++]=i;for(n>>=7;i<m;i++)for(z[i]=n<<7,t=0;t<1<<M[i]-7;t++)R[256+n++]=i;for(e=0;e<=_;e++)a[e]=0;for(t=0;t<=143;)B[2*t+1]=8,t++,a[8]++;for(;t<=255;)B[2*t+1]=9,t++,a[9]++;for(;t<=279;)B[2*t+1]=7,t++,a[7]++;for(;t<=287;)B[2*t+1]=8,t++,a[8]++;for(q(B,p+1,a),t=0;t<m;t++)T[2*t+1]=5,T[2*t]=W(t,5);L=new D(B,S,d+1,p,_),C=new D(T,M,0,m,_),U=new D(new Array(0),A,0,g,w)}(),tt=!0),t.l_desc=new N(t.dyn_ltree,L),t.d_desc=new N(t.dyn_dtree,C),t.bl_desc=new N(t.bl_tree,U),t.bi_buf=0,t.bi_valid=0,Z(t)},r._tr_stored_block=et,r._tr_flush_block=function(t,e,r,i){var h,l,c=0;t.level>0?(t.strm.data_type===s&&(t.strm.data_type=function(t){var e,r=4093624447;for(e=0;e<=31;e++,r>>>=1)if(1&r&&0!==t.dyn_ltree[2*e])return a;if(0!==t.dyn_ltree[18]||0!==t.dyn_ltree[20]||0!==t.dyn_ltree[26])return o;for(e=32;e<d;e++)if(0!==t.dyn_ltree[2*e])return o;return a}(t)),Q(t,t.l_desc),Q(t,t.d_desc),c=function(t){var e;for(K(t,t.dyn_ltree,t.l_desc.max_code),K(t,t.dyn_dtree,t.d_desc.max_code),Q(t,t.bl_desc),e=g-1;e>=3&&0===t.bl_tree[2*I[e]+1];e--);return t.opt_len+=3*(e+1)+5+5+4,e}(t),h=t.opt_len+3+7>>>3,(l=t.static_len+3+7>>>3)<=h&&(h=l)):h=l=r+5,r+4<=h&&-1!==e?et(t,e,r,i):t.strategy===n||l===h?(G(t,(f<<1)+(i?1:0),3),J(t,B,T)):(G(t,(u<<1)+(i?1:0),3),function(t,e,r,i){var n;for(G(t,e-257,5),G(t,r-1,5),G(t,i-4,4),n=0;n<i;n++)G(t,t.bl_tree[2*I[n]+1],3);$(t,t.dyn_ltree,e-1),$(t,t.dyn_dtree,r-1)}(t,t.l_desc.max_code+1,t.d_desc.max_code+1,c+1),J(t,t.dyn_ltree,t.dyn_dtree)),Z(t),i&&Y(t)},r._tr_tally=function(t,e,r){return t.pending_buf[t.d_buf+2*t.last_lit]=e>>>8&255,t.pending_buf[t.d_buf+2*t.last_lit+1]=255&e,t.pending_buf[t.l_buf+t.last_lit]=255&r,t.last_lit++,0===e?t.dyn_ltree[2*r]++:(t.matches++,e--,t.dyn_ltree[2*(P[r]+d+1)]++,t.dyn_dtree[2*F(e)]++),t.last_lit===t.lit_bufsize-1},r._tr_align=function(t){G(t,f<<1,3),H(t,v,B),function(t){16===t.bi_valid?(j(t,t.bi_buf),t.bi_buf=0,t.bi_valid=0):t.bi_valid>=8&&(t.pending_buf[t.pending++]=255&t.bi_buf,t.bi_buf>>=8,t.bi_valid-=8)}(t)}},{"../utils/common":49}],59:[function(t,e,r){"use strict";e.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0}},{}],60:[function(t,e,r){var i,n,a=e.exports={};function o(){throw new Error("setTimeout has not been defined")}function s(){throw new Error("clearTimeout has not been defined")}function h(t){if(i===setTimeout)return setTimeout(t,0);if((i===o||!i)&&setTimeout)return i=setTimeout,setTimeout(t,0);try{return i(t,0)}catch(e){try{return i.call(null,t,0)}catch(e){return i.call(this,t,0)}}}!function(){try{i="function"==typeof setTimeout?setTimeout:o}catch(t){i=o}try{n="function"==typeof clearTimeout?clearTimeout:s}catch(t){n=s}}();var l,f=[],u=!1,c=-1;function d(){u&&l&&(u=!1,l.length?f=l.concat(f):c=-1,f.length&&p())}function p(){if(!u){var t=h(d);u=!0;for(var e=f.length;e;){for(l=f,f=[];++c<e;)l&&l[c].run();c=-1,e=f.length}l=null,u=!1,function(t){if(n===clearTimeout)return clearTimeout(t);if((n===s||!n)&&clearTimeout)return n=clearTimeout,clearTimeout(t);try{n(t)}catch(e){try{return n.call(null,t)}catch(e){return n.call(this,t)}}}(t)}}function m(t,e){this.fun=t,this.array=e}function g(){}a.nextTick=function(t){var e=new Array(arguments.length-1);if(arguments.length>1)for(var r=1;r<arguments.length;r++)e[r-1]=arguments[r];f.push(new m(t,e)),1!==f.length||u||h(p)},m.prototype.run=function(){this.fun.apply(null,this.array)},a.title="browser",a.browser=!0,a.env={},a.argv=[],a.version="",a.versions={},a.on=g,a.addListener=g,a.once=g,a.off=g,a.removeListener=g,a.removeAllListeners=g,a.emit=g,a.prependListener=g,a.prependOnceListener=g,a.listeners=function(t){return[]},a.binding=function(t){throw new Error("process.binding is not supported")},a.cwd=function(){return"/"},a.chdir=function(t){throw new Error("process.chdir is not supported")},a.umask=function(){return 0}},{}],61:[function(t,e,r){e.exports=n;var i=t("events").EventEmitter;function n(){i.call(this)}t("inherits")(n,i),n.Readable=t("readable-stream/lib/_stream_readable.js"),n.Writable=t("readable-stream/lib/_stream_writable.js"),n.Duplex=t("readable-stream/lib/_stream_duplex.js"),n.Transform=t("readable-stream/lib/_stream_transform.js"),n.PassThrough=t("readable-stream/lib/_stream_passthrough.js"),n.finished=t("readable-stream/lib/internal/streams/end-of-stream.js"),n.pipeline=t("readable-stream/lib/internal/streams/pipeline.js"),n.Stream=n,n.prototype.pipe=function(t,e){var r=this;function n(e){t.writable&&!1===t.write(e)&&r.pause&&r.pause()}function a(){r.readable&&r.resume&&r.resume()}r.on("data",n),t.on("drain",a),t._isStdio||e&&!1===e.end||(r.on("end",s),r.on("close",h));var o=!1;function s(){o||(o=!0,t.end())}function h(){o||(o=!0,"function"==typeof t.destroy&&t.destroy())}function l(t){if(f(),0===i.listenerCount(this,"error"))throw t}function f(){r.removeListener("data",n),t.removeListener("drain",a),r.removeListener("end",s),r.removeListener("close",h),r.removeListener("error",l),t.removeListener("error",l),r.removeListener("end",f),r.removeListener("close",f),t.removeListener("close",f)}return r.on("error",l),t.on("error",l),r.on("end",f),r.on("close",f),t.on("close",f),t.emit("pipe",r),t}},{events:38,inherits:45,"readable-stream/lib/_stream_duplex.js":63,"readable-stream/lib/_stream_passthrough.js":64,"readable-stream/lib/_stream_readable.js":65,"readable-stream/lib/_stream_transform.js":66,"readable-stream/lib/_stream_writable.js":67,"readable-stream/lib/internal/streams/end-of-stream.js":71,"readable-stream/lib/internal/streams/pipeline.js":73}],62:[function(t,e,r){"use strict";var i={};function n(t,e,r){r||(r=Error);var n=function(t){function r(r,i,n){return t.call(this,function(t,r,i){return"string"==typeof e?e:e(t,r,i)}(r,i,n))||this}return n=t,(i=r).prototype=Object.create(n.prototype),i.prototype.constructor=i,i.__proto__=n,r;var i,n}(r);n.prototype.name=r.name,n.prototype.code=t,i[t]=n}function a(t,e){if(Array.isArray(t)){var r=t.length;return t=t.map((function(t){return String(t)})),r>2?"one of ".concat(e," ").concat(t.slice(0,r-1).join(", "),", or ")+t[r-1]:2===r?"one of ".concat(e," ").concat(t[0]," or ").concat(t[1]):"of ".concat(e," ").concat(t[0])}return"of ".concat(e," ").concat(String(t))}n("ERR_INVALID_OPT_VALUE",(function(t,e){return'The value "'+e+'" is invalid for option "'+t+'"'}),TypeError),n("ERR_INVALID_ARG_TYPE",(function(t,e,r){var i,n,o,s;if("string"==typeof e&&(o="not ",e.substr(!s||s<0?0:+s,o.length)===o)?(i="must not be",e=e.replace(/^not /,"")):i="must be",function(t,e,r){return(void 0===r||r>t.length)&&(r=t.length),t.substring(r-e.length,r)===e}(t," argument"))n="The ".concat(t," ").concat(i," ").concat(a(e,"type"));else{var h=function(t,e,r){return"number"!=typeof r&&(r=0),!(r+e.length>t.length)&&-1!==t.indexOf(e,r)}(t,".")?"property":"argument";n='The "'.concat(t,'" ').concat(h," ").concat(i," ").concat(a(e,"type"))}return n+". Received type ".concat(typeof r)}),TypeError),n("ERR_STREAM_PUSH_AFTER_EOF","stream.push() after EOF"),n("ERR_METHOD_NOT_IMPLEMENTED",(function(t){return"The "+t+" method is not implemented"})),n("ERR_STREAM_PREMATURE_CLOSE","Premature close"),n("ERR_STREAM_DESTROYED",(function(t){return"Cannot call "+t+" after a stream was destroyed"})),n("ERR_MULTIPLE_CALLBACK","Callback called multiple times"),n("ERR_STREAM_CANNOT_PIPE","Cannot pipe, not readable"),n("ERR_STREAM_WRITE_AFTER_END","write after end"),n("ERR_STREAM_NULL_VALUES","May not write null values to stream",TypeError),n("ERR_UNKNOWN_ENCODING",(function(t){return"Unknown encoding: "+t}),TypeError),n("ERR_STREAM_UNSHIFT_AFTER_END_EVENT","stream.unshift() after end event"),e.exports.codes=i},{}],63:[function(t,e,r){(function(r){(function(){"use strict";var i=Object.keys||function(t){var e=[];for(var r in t)e.push(r);return e};e.exports=l;var n=t("./_stream_readable"),a=t("./_stream_writable");t("inherits")(l,n);for(var o=i(a.prototype),s=0;s<o.length;s++){var h=o[s];l.prototype[h]||(l.prototype[h]=a.prototype[h])}function l(t){if(!(this instanceof l))return new l(t);n.call(this,t),a.call(this,t),this.allowHalfOpen=!0,t&&(!1===t.readable&&(this.readable=!1),!1===t.writable&&(this.writable=!1),!1===t.allowHalfOpen&&(this.allowHalfOpen=!1,this.once("end",f)))}function f(){this._writableState.ended||r.nextTick(u,this)}function u(t){t.end()}Object.defineProperty(l.prototype,"writableHighWaterMark",{enumerable:!1,get:function(){return this._writableState.highWaterMark}}),Object.defineProperty(l.prototype,"writableBuffer",{enumerable:!1,get:function(){return this._writableState&&this._writableState.getBuffer()}}),Object.defineProperty(l.prototype,"writableLength",{enumerable:!1,get:function(){return this._writableState.length}}),Object.defineProperty(l.prototype,"destroyed",{enumerable:!1,get:function(){return void 0!==this._readableState&&void 0!==this._writableState&&this._readableState.destroyed&&this._writableState.destroyed},set:function(t){void 0!==this._readableState&&void 0!==this._writableState&&(this._readableState.destroyed=t,this._writableState.destroyed=t)}})}).call(this)}).call(this,t("_process"))},{"./_stream_readable":65,"./_stream_writable":67,_process:60,inherits:45}],64:[function(t,e,r){"use strict";e.exports=n;var i=t("./_stream_transform");function n(t){if(!(this instanceof n))return new n(t);i.call(this,t)}t("inherits")(n,i),n.prototype._transform=function(t,e,r){r(null,t)}},{"./_stream_transform":66,inherits:45}],65:[function(t,e,i){(function(r,i){(function(){"use strict";var n;e.exports=S,S.ReadableState=k,t("events").EventEmitter;var a=function(t,e){return t.listeners(e).length},o=t("./internal/streams/stream"),s=t("buffer").Buffer,h=i.Uint8Array||function(){};var l,f=t("util");l=f&&f.debuglog?f.debuglog("stream"):function(){};var u,c,d,p=t("./internal/streams/buffer_list"),m=t("./internal/streams/destroy"),g=t("./internal/streams/state").getHighWaterMark,b=t("../errors").codes,_=b.ERR_INVALID_ARG_TYPE,y=b.ERR_STREAM_PUSH_AFTER_EOF,w=b.ERR_METHOD_NOT_IMPLEMENTED,v=b.ERR_STREAM_UNSHIFT_AFTER_END_EVENT;t("inherits")(S,o);var x=m.errorOrDestroy,E=["error","close","destroy","pause","resume"];function k(e,r,i){n=n||t("./_stream_duplex"),e=e||{},"boolean"!=typeof i&&(i=r instanceof n),this.objectMode=!!e.objectMode,i&&(this.objectMode=this.objectMode||!!e.readableObjectMode),this.highWaterMark=g(this,e,"readableHighWaterMark",i),this.buffer=new p,this.length=0,this.pipes=null,this.pipesCount=0,this.flowing=null,this.ended=!1,this.endEmitted=!1,this.reading=!1,this.sync=!0,this.needReadable=!1,this.emittedReadable=!1,this.readableListening=!1,this.resumeScheduled=!1,this.paused=!0,this.emitClose=!1!==e.emitClose,this.autoDestroy=!!e.autoDestroy,this.destroyed=!1,this.defaultEncoding=e.defaultEncoding||"utf8",this.awaitDrain=0,this.readingMore=!1,this.decoder=null,this.encoding=null,e.encoding&&(u||(u=t("string_decoder/").StringDecoder),this.decoder=new u(e.encoding),this.encoding=e.encoding)}function S(e){if(n=n||t("./_stream_duplex"),!(this instanceof S))return new S(e);var r=this instanceof n;this._readableState=new k(e,this,r),this.readable=!0,e&&("function"==typeof e.read&&(this._read=e.read),"function"==typeof e.destroy&&(this._destroy=e.destroy)),o.call(this)}function M(t,e,r,i,n){l("readableAddChunk",e);var a,o=t._readableState;if(null===e)o.reading=!1,function(t,e){if(l("onEofChunk"),!e.ended){if(e.decoder){var r=e.decoder.end();r&&r.length&&(e.buffer.push(r),e.length+=e.objectMode?1:r.length)}e.ended=!0,e.sync?T(t):(e.needReadable=!1,e.emittedReadable||(e.emittedReadable=!0,R(t)))}}(t,o);else if(n||(a=function(t,e){var r;return i=e,s.isBuffer(i)||i instanceof h||"string"==typeof e||void 0===e||t.objectMode||(r=new _("chunk",["string","Buffer","Uint8Array"],e)),r;var i}(o,e)),a)x(t,a);else if(o.objectMode||e&&e.length>0)if("string"==typeof e||o.objectMode||Object.getPrototypeOf(e)===s.prototype||(e=function(t){return s.from(t)}(e)),i)o.endEmitted?x(t,new v):A(t,o,e,!0);else if(o.ended)x(t,new y);else{if(o.destroyed)return!1;o.reading=!1,o.decoder&&!r?(e=o.decoder.write(e),o.objectMode||0!==e.length?A(t,o,e,!1):P(t,o)):A(t,o,e,!1)}else i||(o.reading=!1,P(t,o));return!o.ended&&(o.length<o.highWaterMark||0===o.length)}function A(t,e,r,i){e.flowing&&0===e.length&&!e.sync?(e.awaitDrain=0,t.emit("data",r)):(e.length+=e.objectMode?1:r.length,i?e.buffer.unshift(r):e.buffer.push(r),e.needReadable&&T(t)),P(t,e)}Object.defineProperty(S.prototype,"destroyed",{enumerable:!1,get:function(){return void 0!==this._readableState&&this._readableState.destroyed},set:function(t){this._readableState&&(this._readableState.destroyed=t)}}),S.prototype.destroy=m.destroy,S.prototype._undestroy=m.undestroy,S.prototype._destroy=function(t,e){e(t)},S.prototype.push=function(t,e){var r,i=this._readableState;return i.objectMode?r=!0:"string"==typeof t&&((e=e||i.defaultEncoding)!==i.encoding&&(t=s.from(t,e),e=""),r=!0),M(this,t,e,!1,r)},S.prototype.unshift=function(t){return M(this,t,null,!0,!1)},S.prototype.isPaused=function(){return!1===this._readableState.flowing},S.prototype.setEncoding=function(e){u||(u=t("string_decoder/").StringDecoder);var r=new u(e);this._readableState.decoder=r,this._readableState.encoding=this._readableState.decoder.encoding;for(var i=this._readableState.buffer.head,n="";null!==i;)n+=r.write(i.data),i=i.next;return this._readableState.buffer.clear(),""!==n&&this._readableState.buffer.push(n),this._readableState.length=n.length,this};var I=1073741824;function B(t,e){return t<=0||0===e.length&&e.ended?0:e.objectMode?1:t!=t?e.flowing&&e.length?e.buffer.head.data.length:e.length:(t>e.highWaterMark&&(e.highWaterMark=function(t){return t>=I?t=I:(t--,t|=t>>>1,t|=t>>>2,t|=t>>>4,t|=t>>>8,t|=t>>>16,t++),t}(t)),t<=e.length?t:e.ended?e.length:(e.needReadable=!0,0))}function T(t){var e=t._readableState;l("emitReadable",e.needReadable,e.emittedReadable),e.needReadable=!1,e.emittedReadable||(l("emitReadable",e.flowing),e.emittedReadable=!0,r.nextTick(R,t))}function R(t){var e=t._readableState;l("emitReadable_",e.destroyed,e.length,e.ended),e.destroyed||!e.length&&!e.ended||(t.emit("readable"),e.emittedReadable=!1),e.needReadable=!e.flowing&&!e.ended&&e.length<=e.highWaterMark,z(t)}function P(t,e){e.readingMore||(e.readingMore=!0,r.nextTick(O,t,e))}function O(t,e){for(;!e.reading&&!e.ended&&(e.length<e.highWaterMark||e.flowing&&0===e.length);){var r=e.length;if(l("maybeReadMore read 0"),t.read(0),r===e.length)break}e.readingMore=!1}function L(t){var e=t._readableState;e.readableListening=t.listenerCount("readable")>0,e.resumeScheduled&&!e.paused?e.flowing=!0:t.listenerCount("data")>0&&t.resume()}function C(t){l("readable nexttick read 0"),t.read(0)}function U(t,e){l("resume",e.reading),e.reading||t.read(0),e.resumeScheduled=!1,t.emit("resume"),z(t),e.flowing&&!e.reading&&t.read(0)}function z(t){var e=t._readableState;for(l("flow",e.flowing);e.flowing&&null!==t.read(););}function D(t,e){return 0===e.length?null:(e.objectMode?r=e.buffer.shift():!t||t>=e.length?(r=e.decoder?e.buffer.join(""):1===e.buffer.length?e.buffer.first():e.buffer.concat(e.length),e.buffer.clear()):r=e.buffer.consume(t,e.decoder),r);var r}function N(t){var e=t._readableState;l("endReadable",e.endEmitted),e.endEmitted||(e.ended=!0,r.nextTick(F,e,t))}function F(t,e){if(l("endReadableNT",t.endEmitted,t.length),!t.endEmitted&&0===t.length&&(t.endEmitted=!0,e.readable=!1,e.emit("end"),t.autoDestroy)){var r=e._writableState;(!r||r.autoDestroy&&r.finished)&&e.destroy()}}function j(t,e){for(var r=0,i=t.length;r<i;r++)if(t[r]===e)return r;return-1}S.prototype.read=function(t){l("read",t),t=parseInt(t,10);var e=this._readableState,r=t;if(0!==t&&(e.emittedReadable=!1),0===t&&e.needReadable&&((0!==e.highWaterMark?e.length>=e.highWaterMark:e.length>0)||e.ended))return l("read: emitReadable",e.length,e.ended),0===e.length&&e.ended?N(this):T(this),null;if(0===(t=B(t,e))&&e.ended)return 0===e.length&&N(this),null;var i,n=e.needReadable;return l("need readable",n),(0===e.length||e.length-t<e.highWaterMark)&&l("length less than watermark",n=!0),e.ended||e.reading?l("reading or ended",n=!1):n&&(l("do read"),e.reading=!0,e.sync=!0,0===e.length&&(e.needReadable=!0),this._read(e.highWaterMark),e.sync=!1,e.reading||(t=B(r,e))),null===(i=t>0?D(t,e):null)?(e.needReadable=e.length<=e.highWaterMark,t=0):(e.length-=t,e.awaitDrain=0),0===e.length&&(e.ended||(e.needReadable=!0),r!==t&&e.ended&&N(this)),null!==i&&this.emit("data",i),i},S.prototype._read=function(t){x(this,new w("_read()"))},S.prototype.pipe=function(t,e){var i=this,n=this._readableState;switch(n.pipesCount){case 0:n.pipes=t;break;case 1:n.pipes=[n.pipes,t];break;default:n.pipes.push(t)}n.pipesCount+=1,l("pipe count=%d opts=%j",n.pipesCount,e);var o=e&&!1===e.end||t===r.stdout||t===r.stderr?g:h;function s(e,r){l("onunpipe"),e===i&&r&&!1===r.hasUnpiped&&(r.hasUnpiped=!0,l("cleanup"),t.removeListener("close",p),t.removeListener("finish",m),t.removeListener("drain",f),t.removeListener("error",d),t.removeListener("unpipe",s),i.removeListener("end",h),i.removeListener("end",g),i.removeListener("data",c),u=!0,!n.awaitDrain||t._writableState&&!t._writableState.needDrain||f())}function h(){l("onend"),t.end()}n.endEmitted?r.nextTick(o):i.once("end",o),t.on("unpipe",s);var f=function(t){return function(){var e=t._readableState;l("pipeOnDrain",e.awaitDrain),e.awaitDrain&&e.awaitDrain--,0===e.awaitDrain&&a(t,"data")&&(e.flowing=!0,z(t))}}(i);t.on("drain",f);var u=!1;function c(e){l("ondata");var r=t.write(e);l("dest.write",r),!1===r&&((1===n.pipesCount&&n.pipes===t||n.pipesCount>1&&-1!==j(n.pipes,t))&&!u&&(l("false write response, pause",n.awaitDrain),n.awaitDrain++),i.pause())}function d(e){l("onerror",e),g(),t.removeListener("error",d),0===a(t,"error")&&x(t,e)}function p(){t.removeListener("finish",m),g()}function m(){l("onfinish"),t.removeListener("close",p),g()}function g(){l("unpipe"),i.unpipe(t)}return i.on("data",c),function(t,e,r){if("function"==typeof t.prependListener)return t.prependListener(e,r);t._events&&t._events[e]?Array.isArray(t._events[e])?t._events[e].unshift(r):t._events[e]=[r,t._events[e]]:t.on(e,r)}(t,"error",d),t.once("close",p),t.once("finish",m),t.emit("pipe",i),n.flowing||(l("pipe resume"),i.resume()),t},S.prototype.unpipe=function(t){var e=this._readableState,r={hasUnpiped:!1};if(0===e.pipesCount)return this;if(1===e.pipesCount)return t&&t!==e.pipes||(t||(t=e.pipes),e.pipes=null,e.pipesCount=0,e.flowing=!1,t&&t.emit("unpipe",this,r)),this;if(!t){var i=e.pipes,n=e.pipesCount;e.pipes=null,e.pipesCount=0,e.flowing=!1;for(var a=0;a<n;a++)i[a].emit("unpipe",this,{hasUnpiped:!1});return this}var o=j(e.pipes,t);return-1===o||(e.pipes.splice(o,1),e.pipesCount-=1,1===e.pipesCount&&(e.pipes=e.pipes[0]),t.emit("unpipe",this,r)),this},S.prototype.on=function(t,e){var i=o.prototype.on.call(this,t,e),n=this._readableState;return"data"===t?(n.readableListening=this.listenerCount("readable")>0,!1!==n.flowing&&this.resume()):"readable"===t&&(n.endEmitted||n.readableListening||(n.readableListening=n.needReadable=!0,n.flowing=!1,n.emittedReadable=!1,l("on readable",n.length,n.reading),n.length?T(this):n.reading||r.nextTick(C,this))),i},S.prototype.addListener=S.prototype.on,S.prototype.removeListener=function(t,e){var i=o.prototype.removeListener.call(this,t,e);return"readable"===t&&r.nextTick(L,this),i},S.prototype.removeAllListeners=function(t){var e=o.prototype.removeAllListeners.apply(this,arguments);return"readable"!==t&&void 0!==t||r.nextTick(L,this),e},S.prototype.resume=function(){var t=this._readableState;return t.flowing||(l("resume"),t.flowing=!t.readableListening,function(t,e){e.resumeScheduled||(e.resumeScheduled=!0,r.nextTick(U,t,e))}(this,t)),t.paused=!1,this},S.prototype.pause=function(){return l("call pause flowing=%j",this._readableState.flowing),!1!==this._readableState.flowing&&(l("pause"),this._readableState.flowing=!1,this.emit("pause")),this._readableState.paused=!0,this},S.prototype.wrap=function(t){var e=this,r=this._readableState,i=!1;for(var n in t.on("end",(function(){if(l("wrapped end"),r.decoder&&!r.ended){var t=r.decoder.end();t&&t.length&&e.push(t)}e.push(null)})),t.on("data",(function(n){l("wrapped data"),r.decoder&&(n=r.decoder.write(n)),r.objectMode&&null==n||(r.objectMode||n&&n.length)&&(e.push(n)||(i=!0,t.pause()))})),t)void 0===this[n]&&"function"==typeof t[n]&&(this[n]=function(e){return function(){return t[e].apply(t,arguments)}}(n));for(var a=0;a<E.length;a++)t.on(E[a],this.emit.bind(this,E[a]));return this._read=function(e){l("wrapped _read",e),i&&(i=!1,t.resume())},this},"function"==typeof Symbol&&(S.prototype[Symbol.asyncIterator]=function(){return void 0===c&&(c=t("./internal/streams/async_iterator")),c(this)}),Object.defineProperty(S.prototype,"readableHighWaterMark",{enumerable:!1,get:function(){return this._readableState.highWaterMark}}),Object.defineProperty(S.prototype,"readableBuffer",{enumerable:!1,get:function(){return this._readableState&&this._readableState.buffer}}),Object.defineProperty(S.prototype,"readableFlowing",{enumerable:!1,get:function(){return this._readableState.flowing},set:function(t){this._readableState&&(this._readableState.flowing=t)}}),S._fromList=D,Object.defineProperty(S.prototype,"readableLength",{enumerable:!1,get:function(){return this._readableState.length}}),"function"==typeof Symbol&&(S.from=function(e,r){return void 0===d&&(d=t("./internal/streams/from")),d(S,e,r)})}).call(this)}).call(this,t("_process"),void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"../errors":62,"./_stream_duplex":63,"./internal/streams/async_iterator":68,"./internal/streams/buffer_list":69,"./internal/streams/destroy":70,"./internal/streams/from":72,"./internal/streams/state":74,"./internal/streams/stream":75,_process:60,buffer:33,events:38,inherits:45,"string_decoder/":76,util:30}],66:[function(t,e,r){"use strict";e.exports=f;var i=t("../errors").codes,n=i.ERR_METHOD_NOT_IMPLEMENTED,a=i.ERR_MULTIPLE_CALLBACK,o=i.ERR_TRANSFORM_ALREADY_TRANSFORMING,s=i.ERR_TRANSFORM_WITH_LENGTH_0,h=t("./_stream_duplex");function l(t,e){var r=this._transformState;r.transforming=!1;var i=r.writecb;if(null===i)return this.emit("error",new a);r.writechunk=null,r.writecb=null,null!=e&&this.push(e),i(t);var n=this._readableState;n.reading=!1,(n.needReadable||n.length<n.highWaterMark)&&this._read(n.highWaterMark)}function f(t){if(!(this instanceof f))return new f(t);h.call(this,t),this._transformState={afterTransform:l.bind(this),needTransform:!1,transforming:!1,writecb:null,writechunk:null,writeencoding:null},this._readableState.needReadable=!0,this._readableState.sync=!1,t&&("function"==typeof t.transform&&(this._transform=t.transform),"function"==typeof t.flush&&(this._flush=t.flush)),this.on("prefinish",u)}function u(){var t=this;"function"!=typeof this._flush||this._readableState.destroyed?c(this,null,null):this._flush((function(e,r){c(t,e,r)}))}function c(t,e,r){if(e)return t.emit("error",e);if(null!=r&&t.push(r),t._writableState.length)throw new s;if(t._transformState.transforming)throw new o;return t.push(null)}t("inherits")(f,h),f.prototype.push=function(t,e){return this._transformState.needTransform=!1,h.prototype.push.call(this,t,e)},f.prototype._transform=function(t,e,r){r(new n("_transform()"))},f.prototype._write=function(t,e,r){var i=this._transformState;if(i.writecb=r,i.writechunk=t,i.writeencoding=e,!i.transforming){var n=this._readableState;(i.needTransform||n.needReadable||n.length<n.highWaterMark)&&this._read(n.highWaterMark)}},f.prototype._read=function(t){var e=this._transformState;null===e.writechunk||e.transforming?e.needTransform=!0:(e.transforming=!0,this._transform(e.writechunk,e.writeencoding,e.afterTransform))},f.prototype._destroy=function(t,e){h.prototype._destroy.call(this,t,(function(t){e(t)}))}},{"../errors":62,"./_stream_duplex":63,inherits:45}],67:[function(t,e,i){(function(r,i){(function(){"use strict";function n(t){var e=this;this.next=null,this.entry=null,this.finish=function(){!function(t,e,r){var i=t.entry;for(t.entry=null;i;){var n=i.callback;e.pendingcb--,n(r),i=i.next}e.corkedRequestsFree.next=t}(e,t)}}var a;e.exports=S,S.WritableState=k;var o={deprecate:t("util-deprecate")},s=t("./internal/streams/stream"),h=t("buffer").Buffer,l=i.Uint8Array||function(){};var f,u=t("./internal/streams/destroy"),c=t("./internal/streams/state").getHighWaterMark,d=t("../errors").codes,p=d.ERR_INVALID_ARG_TYPE,m=d.ERR_METHOD_NOT_IMPLEMENTED,g=d.ERR_MULTIPLE_CALLBACK,b=d.ERR_STREAM_CANNOT_PIPE,_=d.ERR_STREAM_DESTROYED,y=d.ERR_STREAM_NULL_VALUES,w=d.ERR_STREAM_WRITE_AFTER_END,v=d.ERR_UNKNOWN_ENCODING,x=u.errorOrDestroy;function E(){}function k(e,i,o){a=a||t("./_stream_duplex"),e=e||{},"boolean"!=typeof o&&(o=i instanceof a),this.objectMode=!!e.objectMode,o&&(this.objectMode=this.objectMode||!!e.writableObjectMode),this.highWaterMark=c(this,e,"writableHighWaterMark",o),this.finalCalled=!1,this.needDrain=!1,this.ending=!1,this.ended=!1,this.finished=!1,this.destroyed=!1;var s=!1===e.decodeStrings;this.decodeStrings=!s,this.defaultEncoding=e.defaultEncoding||"utf8",this.length=0,this.writing=!1,this.corked=0,this.sync=!0,this.bufferProcessing=!1,this.onwrite=function(t){!function(t,e){var i=t._writableState,n=i.sync,a=i.writecb;if("function"!=typeof a)throw new g;if(function(t){t.writing=!1,t.writecb=null,t.length-=t.writelen,t.writelen=0}(i),e)!function(t,e,i,n,a){--e.pendingcb,i?(r.nextTick(a,n),r.nextTick(P,t,e),t._writableState.errorEmitted=!0,x(t,n)):(a(n),t._writableState.errorEmitted=!0,x(t,n),P(t,e))}(t,i,n,e,a);else{var o=T(i)||t.destroyed;o||i.corked||i.bufferProcessing||!i.bufferedRequest||B(t,i),n?r.nextTick(I,t,i,o,a):I(t,i,o,a)}}(i,t)},this.writecb=null,this.writelen=0,this.bufferedRequest=null,this.lastBufferedRequest=null,this.pendingcb=0,this.prefinished=!1,this.errorEmitted=!1,this.emitClose=!1!==e.emitClose,this.autoDestroy=!!e.autoDestroy,this.bufferedRequestCount=0,this.corkedRequestsFree=new n(this)}function S(e){var r=this instanceof(a=a||t("./_stream_duplex"));if(!r&&!f.call(S,this))return new S(e);this._writableState=new k(e,this,r),this.writable=!0,e&&("function"==typeof e.write&&(this._write=e.write),"function"==typeof e.writev&&(this._writev=e.writev),"function"==typeof e.destroy&&(this._destroy=e.destroy),"function"==typeof e.final&&(this._final=e.final)),s.call(this)}function M(t,e,r,i,n,a){if(!r){var o=function(t,e,r){return t.objectMode||!1===t.decodeStrings||"string"!=typeof e||(e=h.from(e,r)),e}(e,i,n);i!==o&&(r=!0,n="buffer",i=o)}var s=e.objectMode?1:i.length;e.length+=s;var l=e.length<e.highWaterMark;if(l||(e.needDrain=!0),e.writing||e.corked){var f=e.lastBufferedRequest;e.lastBufferedRequest={chunk:i,encoding:n,isBuf:r,callback:a,next:null},f?f.next=e.lastBufferedRequest:e.bufferedRequest=e.lastBufferedRequest,e.bufferedRequestCount+=1}else A(t,e,!1,s,i,n,a);return l}function A(t,e,r,i,n,a,o){e.writelen=i,e.writecb=o,e.writing=!0,e.sync=!0,e.destroyed?e.onwrite(new _("write")):r?t._writev(n,e.onwrite):t._write(n,a,e.onwrite),e.sync=!1}function I(t,e,r,i){r||function(t,e){0===e.length&&e.needDrain&&(e.needDrain=!1,t.emit("drain"))}(t,e),e.pendingcb--,i(),P(t,e)}function B(t,e){e.bufferProcessing=!0;var r=e.bufferedRequest;if(t._writev&&r&&r.next){var i=e.bufferedRequestCount,a=new Array(i),o=e.corkedRequestsFree;o.entry=r;for(var s=0,h=!0;r;)a[s]=r,r.isBuf||(h=!1),r=r.next,s+=1;a.allBuffers=h,A(t,e,!0,e.length,a,"",o.finish),e.pendingcb++,e.lastBufferedRequest=null,o.next?(e.corkedRequestsFree=o.next,o.next=null):e.corkedRequestsFree=new n(e),e.bufferedRequestCount=0}else{for(;r;){var l=r.chunk,f=r.encoding,u=r.callback;if(A(t,e,!1,e.objectMode?1:l.length,l,f,u),r=r.next,e.bufferedRequestCount--,e.writing)break}null===r&&(e.lastBufferedRequest=null)}e.bufferedRequest=r,e.bufferProcessing=!1}function T(t){return t.ending&&0===t.length&&null===t.bufferedRequest&&!t.finished&&!t.writing}function R(t,e){t._final((function(r){e.pendingcb--,r&&x(t,r),e.prefinished=!0,t.emit("prefinish"),P(t,e)}))}function P(t,e){var i=T(e);if(i&&(function(t,e){e.prefinished||e.finalCalled||("function"!=typeof t._final||e.destroyed?(e.prefinished=!0,t.emit("prefinish")):(e.pendingcb++,e.finalCalled=!0,r.nextTick(R,t,e)))}(t,e),0===e.pendingcb&&(e.finished=!0,t.emit("finish"),e.autoDestroy))){var n=t._readableState;(!n||n.autoDestroy&&n.endEmitted)&&t.destroy()}return i}t("inherits")(S,s),k.prototype.getBuffer=function(){for(var t=this.bufferedRequest,e=[];t;)e.push(t),t=t.next;return e},function(){try{Object.defineProperty(k.prototype,"buffer",{get:o.deprecate((function(){return this.getBuffer()}),"_writableState.buffer is deprecated. Use _writableState.getBuffer instead.","DEP0003")})}catch(t){}}(),"function"==typeof Symbol&&Symbol.hasInstance&&"function"==typeof Function.prototype[Symbol.hasInstance]?(f=Function.prototype[Symbol.hasInstance],Object.defineProperty(S,Symbol.hasInstance,{value:function(t){return!!f.call(this,t)||this===S&&t&&t._writableState instanceof k}})):f=function(t){return t instanceof this},S.prototype.pipe=function(){x(this,new b)},S.prototype.write=function(t,e,i){var n,a=this._writableState,o=!1,s=!a.objectMode&&(n=t,h.isBuffer(n)||n instanceof l);return s&&!h.isBuffer(t)&&(t=function(t){return h.from(t)}(t)),"function"==typeof e&&(i=e,e=null),s?e="buffer":e||(e=a.defaultEncoding),"function"!=typeof i&&(i=E),a.ending?function(t,e){var i=new w;x(t,i),r.nextTick(e,i)}(this,i):(s||function(t,e,i,n){var a;return null===i?a=new y:"string"==typeof i||e.objectMode||(a=new p("chunk",["string","Buffer"],i)),!a||(x(t,a),r.nextTick(n,a),!1)}(this,a,t,i))&&(a.pendingcb++,o=M(this,a,s,t,e,i)),o},S.prototype.cork=function(){this._writableState.corked++},S.prototype.uncork=function(){var t=this._writableState;t.corked&&(t.corked--,t.writing||t.corked||t.bufferProcessing||!t.bufferedRequest||B(this,t))},S.prototype.setDefaultEncoding=function(t){if("string"==typeof t&&(t=t.toLowerCase()),!(["hex","utf8","utf-8","ascii","binary","base64","ucs2","ucs-2","utf16le","utf-16le","raw"].indexOf((t+"").toLowerCase())>-1))throw new v(t);return this._writableState.defaultEncoding=t,this},Object.defineProperty(S.prototype,"writableBuffer",{enumerable:!1,get:function(){return this._writableState&&this._writableState.getBuffer()}}),Object.defineProperty(S.prototype,"writableHighWaterMark",{enumerable:!1,get:function(){return this._writableState.highWaterMark}}),S.prototype._write=function(t,e,r){r(new m("_write()"))},S.prototype._writev=null,S.prototype.end=function(t,e,i){var n=this._writableState;return"function"==typeof t?(i=t,t=null,e=null):"function"==typeof e&&(i=e,e=null),null!=t&&this.write(t,e),n.corked&&(n.corked=1,this.uncork()),n.ending||function(t,e,i){e.ending=!0,P(t,e),i&&(e.finished?r.nextTick(i):t.once("finish",i)),e.ended=!0,t.writable=!1}(this,n,i),this},Object.defineProperty(S.prototype,"writableLength",{enumerable:!1,get:function(){return this._writableState.length}}),Object.defineProperty(S.prototype,"destroyed",{enumerable:!1,get:function(){return void 0!==this._writableState&&this._writableState.destroyed},set:function(t){this._writableState&&(this._writableState.destroyed=t)}}),S.prototype.destroy=u.destroy,S.prototype._undestroy=u.undestroy,S.prototype._destroy=function(t,e){e(t)}}).call(this)}).call(this,t("_process"),void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"../errors":62,"./_stream_duplex":63,"./internal/streams/destroy":70,"./internal/streams/state":74,"./internal/streams/stream":75,_process:60,buffer:33,inherits:45,"util-deprecate":78}],68:[function(t,e,r){(function(r){(function(){"use strict";var i;function n(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}var a=t("./end-of-stream"),o=Symbol("lastResolve"),s=Symbol("lastReject"),h=Symbol("error"),l=Symbol("ended"),f=Symbol("lastPromise"),u=Symbol("handlePromise"),c=Symbol("stream");function d(t,e){return{value:t,done:e}}function p(t){var e=t[o];if(null!==e){var r=t[c].read();null!==r&&(t[f]=null,t[o]=null,t[s]=null,e(d(r,!1)))}}function m(t){r.nextTick(p,t)}var g=Object.getPrototypeOf((function(){})),b=Object.setPrototypeOf((n(i={get stream(){return this[c]},next:function(){var t=this,e=this[h];if(null!==e)return Promise.reject(e);if(this[l])return Promise.resolve(d(void 0,!0));if(this[c].destroyed)return new Promise((function(e,i){r.nextTick((function(){t[h]?i(t[h]):e(d(void 0,!0))}))}));var i,n=this[f];if(n)i=new Promise(function(t,e){return function(r,i){t.then((function(){e[l]?r(d(void 0,!0)):e[u](r,i)}),i)}}(n,this));else{var a=this[c].read();if(null!==a)return Promise.resolve(d(a,!1));i=new Promise(this[u])}return this[f]=i,i}},Symbol.asyncIterator,(function(){return this})),n(i,"return",(function(){var t=this;return new Promise((function(e,r){t[c].destroy(null,(function(t){t?r(t):e(d(void 0,!0))}))}))})),i),g);e.exports=function(t){var e,r=Object.create(b,(n(e={},c,{value:t,writable:!0}),n(e,o,{value:null,writable:!0}),n(e,s,{value:null,writable:!0}),n(e,h,{value:null,writable:!0}),n(e,l,{value:t._readableState.endEmitted,writable:!0}),n(e,u,{value:function(t,e){var i=r[c].read();i?(r[f]=null,r[o]=null,r[s]=null,t(d(i,!1))):(r[o]=t,r[s]=e)},writable:!0}),e));return r[f]=null,a(t,(function(t){if(t&&"ERR_STREAM_PREMATURE_CLOSE"!==t.code){var e=r[s];return null!==e&&(r[f]=null,r[o]=null,r[s]=null,e(t)),void(r[h]=t)}var i=r[o];null!==i&&(r[f]=null,r[o]=null,r[s]=null,i(d(void 0,!0))),r[l]=!0})),t.on("readable",m.bind(null,r)),r}}).call(this)}).call(this,t("_process"))},{"./end-of-stream":71,_process:60}],69:[function(t,e,r){"use strict";function i(t,e){var r=Object.keys(t);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(t);e&&(i=i.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),r.push.apply(r,i)}return r}function n(t,e,r){return e in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}function a(t,e){for(var r=0;r<e.length;r++){var i=e[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(t,i.key,i)}}var o=t("buffer").Buffer,s=t("util").inspect,h=s&&s.custom||"inspect";e.exports=function(){function t(){(function(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")})(this,t),this.head=null,this.tail=null,this.length=0}return e=t,r=[{key:"push",value:function(t){var e={data:t,next:null};this.length>0?this.tail.next=e:this.head=e,this.tail=e,++this.length}},{key:"unshift",value:function(t){var e={data:t,next:this.head};0===this.length&&(this.tail=e),this.head=e,++this.length}},{key:"shift",value:function(){if(0!==this.length){var t=this.head.data;return 1===this.length?this.head=this.tail=null:this.head=this.head.next,--this.length,t}}},{key:"clear",value:function(){this.head=this.tail=null,this.length=0}},{key:"join",value:function(t){if(0===this.length)return"";for(var e=this.head,r=""+e.data;e=e.next;)r+=t+e.data;return r}},{key:"concat",value:function(t){if(0===this.length)return o.alloc(0);for(var e=o.allocUnsafe(t>>>0),r=this.head,i=0;r;)n=r.data,a=e,s=i,o.prototype.copy.call(n,a,s),i+=r.data.length,r=r.next;var n,a,s;return e}},{key:"consume",value:function(t,e){var r;return t<this.head.data.length?(r=this.head.data.slice(0,t),this.head.data=this.head.data.slice(t)):r=t===this.head.data.length?this.shift():e?this._getString(t):this._getBuffer(t),r}},{key:"first",value:function(){return this.head.data}},{key:"_getString",value:function(t){var e=this.head,r=1,i=e.data;for(t-=i.length;e=e.next;){var n=e.data,a=t>n.length?n.length:t;if(a===n.length?i+=n:i+=n.slice(0,t),0==(t-=a)){a===n.length?(++r,e.next?this.head=e.next:this.head=this.tail=null):(this.head=e,e.data=n.slice(a));break}++r}return this.length-=r,i}},{key:"_getBuffer",value:function(t){var e=o.allocUnsafe(t),r=this.head,i=1;for(r.data.copy(e),t-=r.data.length;r=r.next;){var n=r.data,a=t>n.length?n.length:t;if(n.copy(e,e.length-t,0,a),0==(t-=a)){a===n.length?(++i,r.next?this.head=r.next:this.head=this.tail=null):(this.head=r,r.data=n.slice(a));break}++i}return this.length-=i,e}},{key:h,value:function(t,e){return s(this,function(t){for(var e=1;e<arguments.length;e++){var r=null!=arguments[e]?arguments[e]:{};e%2?i(Object(r),!0).forEach((function(e){n(t,e,r[e])})):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(r)):i(Object(r)).forEach((function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(r,e))}))}return t}({},e,{depth:0,customInspect:!1}))}}],r&&a(e.prototype,r),l&&a(e,l),t;var e,r,l}()},{buffer:33,util:30}],70:[function(t,e,r){(function(t){(function(){"use strict";function r(t,e){n(t,e),i(t)}function i(t){t._writableState&&!t._writableState.emitClose||t._readableState&&!t._readableState.emitClose||t.emit("close")}function n(t,e){t.emit("error",e)}e.exports={destroy:function(e,a){var o=this,s=this._readableState&&this._readableState.destroyed,h=this._writableState&&this._writableState.destroyed;return s||h?(a?a(e):e&&(this._writableState?this._writableState.errorEmitted||(this._writableState.errorEmitted=!0,t.nextTick(n,this,e)):t.nextTick(n,this,e)),this):(this._readableState&&(this._readableState.destroyed=!0),this._writableState&&(this._writableState.destroyed=!0),this._destroy(e||null,(function(e){!a&&e?o._writableState?o._writableState.errorEmitted?t.nextTick(i,o):(o._writableState.errorEmitted=!0,t.nextTick(r,o,e)):t.nextTick(r,o,e):a?(t.nextTick(i,o),a(e)):t.nextTick(i,o)})),this)},undestroy:function(){this._readableState&&(this._readableState.destroyed=!1,this._readableState.reading=!1,this._readableState.ended=!1,this._readableState.endEmitted=!1),this._writableState&&(this._writableState.destroyed=!1,this._writableState.ended=!1,this._writableState.ending=!1,this._writableState.finalCalled=!1,this._writableState.prefinished=!1,this._writableState.finished=!1,this._writableState.errorEmitted=!1)},errorOrDestroy:function(t,e){var r=t._readableState,i=t._writableState;r&&r.autoDestroy||i&&i.autoDestroy?t.destroy(e):t.emit("error",e)}}}).call(this)}).call(this,t("_process"))},{_process:60}],71:[function(t,e,r){"use strict";var i=t("../../../errors").codes.ERR_STREAM_PREMATURE_CLOSE;function n(){}e.exports=function t(e,r,a){if("function"==typeof r)return t(e,null,r);r||(r={}),a=function(t){var e=!1;return function(){if(!e){e=!0;for(var r=arguments.length,i=new Array(r),n=0;n<r;n++)i[n]=arguments[n];t.apply(this,i)}}}(a||n);var o=r.readable||!1!==r.readable&&e.readable,s=r.writable||!1!==r.writable&&e.writable,h=function(){e.writable||f()},l=e._writableState&&e._writableState.finished,f=function(){s=!1,l=!0,o||a.call(e)},u=e._readableState&&e._readableState.endEmitted,c=function(){o=!1,u=!0,s||a.call(e)},d=function(t){a.call(e,t)},p=function(){var t;return o&&!u?(e._readableState&&e._readableState.ended||(t=new i),a.call(e,t)):s&&!l?(e._writableState&&e._writableState.ended||(t=new i),a.call(e,t)):void 0},m=function(){e.req.on("finish",f)};return function(t){return t.setHeader&&"function"==typeof t.abort}(e)?(e.on("complete",f),e.on("abort",p),e.req?m():e.on("request",m)):s&&!e._writableState&&(e.on("end",h),e.on("close",h)),e.on("end",c),e.on("finish",f),!1!==r.error&&e.on("error",d),e.on("close",p),function(){e.removeListener("complete",f),e.removeListener("abort",p),e.removeListener("request",m),e.req&&e.req.removeListener("finish",f),e.removeListener("end",h),e.removeListener("close",h),e.removeListener("finish",f),e.removeListener("end",c),e.removeListener("error",d),e.removeListener("close",p)}}},{"../../../errors":62}],72:[function(t,e,r){e.exports=function(){throw new Error("Readable.from is not available in the browser")}},{}],73:[function(t,e,r){"use strict";var i;var n=t("../../../errors").codes,a=n.ERR_MISSING_ARGS,o=n.ERR_STREAM_DESTROYED;function s(t){if(t)throw t}function h(t){t()}function l(t,e){return t.pipe(e)}e.exports=function(){for(var e=arguments.length,r=new Array(e),n=0;n<e;n++)r[n]=arguments[n];var f,u=function(t){return t.length?"function"!=typeof t[t.length-1]?s:t.pop():s}(r);if(Array.isArray(r[0])&&(r=r[0]),r.length<2)throw new a("streams");var c=r.map((function(e,n){var a=n<r.length-1;return function(e,r,n,a){a=function(t){var e=!1;return function(){e||(e=!0,t.apply(void 0,arguments))}}(a);var s=!1;e.on("close",(function(){s=!0})),void 0===i&&(i=t("./end-of-stream")),i(e,{readable:r,writable:n},(function(t){if(t)return a(t);s=!0,a()}));var h=!1;return function(t){if(!s&&!h)return h=!0,function(t){return t.setHeader&&"function"==typeof t.abort}(e)?e.abort():"function"==typeof e.destroy?e.destroy():void a(t||new o("pipe"))}}(e,a,n>0,(function(t){f||(f=t),t&&c.forEach(h),a||(c.forEach(h),u(f))}))}));return r.reduce(l)}},{"../../../errors":62,"./end-of-stream":71}],74:[function(t,e,r){"use strict";var i=t("../../../errors").codes.ERR_INVALID_OPT_VALUE;e.exports={getHighWaterMark:function(t,e,r,n){var a=function(t,e,r){return null!=t.highWaterMark?t.highWaterMark:e?t[r]:null}(e,n,r);if(null!=a){if(!isFinite(a)||Math.floor(a)!==a||a<0)throw new i(n?r:"highWaterMark",a);return Math.floor(a)}return t.objectMode?16:16384}}},{"../../../errors":62}],75:[function(t,e,r){e.exports=t("events").EventEmitter},{events:38}],76:[function(t,e,r){"use strict";var i=t("safe-buffer").Buffer,n=i.isEncoding||function(t){switch((t=""+t)&&t.toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":case"raw":return!0;default:return!1}};function a(t){var e;switch(this.encoding=function(t){var e=function(t){if(!t)return"utf8";for(var e;;)switch(t){case"utf8":case"utf-8":return"utf8";case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return"utf16le";case"latin1":case"binary":return"latin1";case"base64":case"ascii":case"hex":return t;default:if(e)return;t=(""+t).toLowerCase(),e=!0}}(t);if("string"!=typeof e&&(i.isEncoding===n||!n(t)))throw new Error("Unknown encoding: "+t);return e||t}(t),this.encoding){case"utf16le":this.text=h,this.end=l,e=4;break;case"utf8":this.fillLast=s,e=4;break;case"base64":this.text=f,this.end=u,e=3;break;default:return this.write=c,void(this.end=d)}this.lastNeed=0,this.lastTotal=0,this.lastChar=i.allocUnsafe(e)}function o(t){return t<=127?0:t>>5==6?2:t>>4==14?3:t>>3==30?4:t>>6==2?-1:-2}function s(t){var e=this.lastTotal-this.lastNeed,r=function(t,e,r){if(128!=(192&e[0]))return t.lastNeed=0,"�";if(t.lastNeed>1&&e.length>1){if(128!=(192&e[1]))return t.lastNeed=1,"�";if(t.lastNeed>2&&e.length>2&&128!=(192&e[2]))return t.lastNeed=2,"�"}}(this,t);return void 0!==r?r:this.lastNeed<=t.length?(t.copy(this.lastChar,e,0,this.lastNeed),this.lastChar.toString(this.encoding,0,this.lastTotal)):(t.copy(this.lastChar,e,0,t.length),void(this.lastNeed-=t.length))}function h(t,e){if((t.length-e)%2==0){var r=t.toString("utf16le",e);if(r){var i=r.charCodeAt(r.length-1);if(i>=55296&&i<=56319)return this.lastNeed=2,this.lastTotal=4,this.lastChar[0]=t[t.length-2],this.lastChar[1]=t[t.length-1],r.slice(0,-1)}return r}return this.lastNeed=1,this.lastTotal=2,this.lastChar[0]=t[t.length-1],t.toString("utf16le",e,t.length-1)}function l(t){var e=t&&t.length?this.write(t):"";if(this.lastNeed){var r=this.lastTotal-this.lastNeed;return e+this.lastChar.toString("utf16le",0,r)}return e}function f(t,e){var r=(t.length-e)%3;return 0===r?t.toString("base64",e):(this.lastNeed=3-r,this.lastTotal=3,1===r?this.lastChar[0]=t[t.length-1]:(this.lastChar[0]=t[t.length-2],this.lastChar[1]=t[t.length-1]),t.toString("base64",e,t.length-r))}function u(t){var e=t&&t.length?this.write(t):"";return this.lastNeed?e+this.lastChar.toString("base64",0,3-this.lastNeed):e}function c(t){return t.toString(this.encoding)}function d(t){return t&&t.length?this.write(t):""}r.StringDecoder=a,a.prototype.write=function(t){if(0===t.length)return"";var e,r;if(this.lastNeed){if(void 0===(e=this.fillLast(t)))return"";r=this.lastNeed,this.lastNeed=0}else r=0;return r<t.length?e?e+this.text(t,r):this.text(t,r):e||""},a.prototype.end=function(t){var e=t&&t.length?this.write(t):"";return this.lastNeed?e+"�":e},a.prototype.text=function(t,e){var r=function(t,e,r){var i=e.length-1;if(i<r)return 0;var n=o(e[i]);return n>=0?(n>0&&(t.lastNeed=n-1),n):--i<r||-2===n?0:(n=o(e[i]))>=0?(n>0&&(t.lastNeed=n-2),n):--i<r||-2===n?0:(n=o(e[i]))>=0?(n>0&&(2===n?n=0:t.lastNeed=n-3),n):0}(this,t,e);if(!this.lastNeed)return t.toString("utf8",e);this.lastTotal=r;var i=t.length-(r-this.lastNeed);return t.copy(this.lastChar,0,i),t.toString("utf8",e,i)},a.prototype.fillLast=function(t){if(this.lastNeed<=t.length)return t.copy(this.lastChar,this.lastTotal-this.lastNeed,0,this.lastNeed),this.lastChar.toString(this.encoding,0,this.lastTotal);t.copy(this.lastChar,this.lastTotal-this.lastNeed,0,t.length),this.lastNeed-=t.length}},{"safe-buffer":77}],77:[function(t,e,r){var i=t("buffer"),n=i.Buffer;function a(t,e){for(var r in t)e[r]=t[r]}function o(t,e,r){return n(t,e,r)}n.from&&n.alloc&&n.allocUnsafe&&n.allocUnsafeSlow?e.exports=i:(a(i,r),r.Buffer=o),o.prototype=Object.create(n.prototype),a(n,o),o.from=function(t,e,r){if("number"==typeof t)throw new TypeError("Argument must not be a number");return n(t,e,r)},o.alloc=function(t,e,r){if("number"!=typeof t)throw new TypeError("Argument must be a number");var i=n(t);return void 0!==e?"string"==typeof r?i.fill(e,r):i.fill(e):i.fill(0),i},o.allocUnsafe=function(t){if("number"!=typeof t)throw new TypeError("Argument must be a number");return n(t)},o.allocUnsafeSlow=function(t){if("number"!=typeof t)throw new TypeError("Argument must be a number");return i.SlowBuffer(t)}},{buffer:33}],78:[function(t,e,i){(function(t){(function(){function r(e){try{if(!t.localStorage)return!1}catch(t){return!1}var r=t.localStorage[e];return null!=r&&"true"===String(r).toLowerCase()}e.exports=function(t,e){if(r("noDeprecation"))return t;var i=!1;return function(){if(!i){if(r("throwDeprecation"))throw new Error(e);r("traceDeprecation")?console.trace(e):console.warn(e),i=!0}return t.apply(this,arguments)}}}).call(this)}).call(this,void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],79:[function(t,e,r){arguments[4][25][0].apply(r,arguments)},{dup:25}],80:[function(t,e,r){"use strict";var i=t("is-arguments"),n=t("is-generator-function"),a=t("which-typed-array"),o=t("is-typed-array");function s(t){return t.call.bind(t)}var h="undefined"!=typeof BigInt,l="undefined"!=typeof Symbol,f=s(Object.prototype.toString),u=s(Number.prototype.valueOf),c=s(String.prototype.valueOf),d=s(Boolean.prototype.valueOf);if(h)var p=s(BigInt.prototype.valueOf);if(l)var m=s(Symbol.prototype.valueOf);function g(t,e){if("object"!=typeof t)return!1;try{return e(t),!0}catch(t){return!1}}function b(t){return"[object Map]"===f(t)}function _(t){return"[object Set]"===f(t)}function y(t){return"[object WeakMap]"===f(t)}function w(t){return"[object WeakSet]"===f(t)}function v(t){return"[object ArrayBuffer]"===f(t)}function x(t){return"undefined"!=typeof ArrayBuffer&&(v.working?v(t):t instanceof ArrayBuffer)}function E(t){return"[object DataView]"===f(t)}function k(t){return"undefined"!=typeof DataView&&(E.working?E(t):t instanceof DataView)}function S(t){return"[object SharedArrayBuffer]"===f(t)}function M(t){return"undefined"!=typeof SharedArrayBuffer&&(S.working?S(t):t instanceof SharedArrayBuffer)}function A(t){return g(t,u)}function I(t){return g(t,c)}function B(t){return g(t,d)}function T(t){return h&&g(t,p)}function R(t){return l&&g(t,m)}r.isArgumentsObject=i,r.isGeneratorFunction=n,r.isTypedArray=o,r.isPromise=function(t){return"undefined"!=typeof Promise&&t instanceof Promise||null!==t&&"object"==typeof t&&"function"==typeof t.then&&"function"==typeof t.catch},r.isArrayBufferView=function(t){return"undefined"!=typeof ArrayBuffer&&ArrayBuffer.isView?ArrayBuffer.isView(t):o(t)||k(t)},r.isUint8Array=function(t){return"Uint8Array"===a(t)},r.isUint8ClampedArray=function(t){return"Uint8ClampedArray"===a(t)},r.isUint16Array=function(t){return"Uint16Array"===a(t)},r.isUint32Array=function(t){return"Uint32Array"===a(t)},r.isInt8Array=function(t){return"Int8Array"===a(t)},r.isInt16Array=function(t){return"Int16Array"===a(t)},r.isInt32Array=function(t){return"Int32Array"===a(t)},r.isFloat32Array=function(t){return"Float32Array"===a(t)},r.isFloat64Array=function(t){return"Float64Array"===a(t)},r.isBigInt64Array=function(t){return"BigInt64Array"===a(t)},r.isBigUint64Array=function(t){return"BigUint64Array"===a(t)},b.working="undefined"!=typeof Map&&b(new Map),r.isMap=function(t){return"undefined"!=typeof Map&&(b.working?b(t):t instanceof Map)},_.working="undefined"!=typeof Set&&_(new Set),r.isSet=function(t){return"undefined"!=typeof Set&&(_.working?_(t):t instanceof Set)},y.working="undefined"!=typeof WeakMap&&y(new WeakMap),r.isWeakMap=function(t){return"undefined"!=typeof WeakMap&&(y.working?y(t):t instanceof WeakMap)},w.working="undefined"!=typeof WeakSet&&w(new WeakSet),r.isWeakSet=function(t){return w(t)},v.working="undefined"!=typeof ArrayBuffer&&v(new ArrayBuffer),r.isArrayBuffer=x,E.working="undefined"!=typeof ArrayBuffer&&"undefined"!=typeof DataView&&E(new DataView(new ArrayBuffer(1),0,1)),r.isDataView=k,S.working="undefined"!=typeof SharedArrayBuffer&&S(new SharedArrayBuffer),r.isSharedArrayBuffer=M,r.isAsyncFunction=function(t){return"[object AsyncFunction]"===f(t)},r.isMapIterator=function(t){return"[object Map Iterator]"===f(t)},r.isSetIterator=function(t){return"[object Set Iterator]"===f(t)},r.isGeneratorObject=function(t){return"[object Generator]"===f(t)},r.isWebAssemblyCompiledModule=function(t){return"[object WebAssembly.Module]"===f(t)},r.isNumberObject=A,r.isStringObject=I,r.isBooleanObject=B,r.isBigIntObject=T,r.isSymbolObject=R,r.isBoxedPrimitive=function(t){return A(t)||I(t)||B(t)||T(t)||R(t)},r.isAnyArrayBuffer=function(t){return"undefined"!=typeof Uint8Array&&(x(t)||M(t))},["isProxy","isExternal","isModuleNamespaceObject"].forEach((function(t){Object.defineProperty(r,t,{enumerable:!1,value:function(){throw new Error(t+" is not supported in userland")}})}))},{"is-arguments":46,"is-generator-function":47,"is-typed-array":48,"which-typed-array":82}],81:[function(t,e,r){(function(e){(function(){var i=Object.getOwnPropertyDescriptors||function(t){for(var e=Object.keys(t),r={},i=0;i<e.length;i++)r[e[i]]=Object.getOwnPropertyDescriptor(t,e[i]);return r},n=/%[sdj%]/g;r.format=function(t){if(!_(t)){for(var e=[],r=0;r<arguments.length;r++)e.push(h(arguments[r]));return e.join(" ")}r=1;for(var i=arguments,a=i.length,o=String(t).replace(n,(function(t){if("%%"===t)return"%";if(r>=a)return t;switch(t){case"%s":return String(i[r++]);case"%d":return Number(i[r++]);case"%j":try{return JSON.stringify(i[r++])}catch(t){return"[Circular]"}default:return t}})),s=i[r];r<a;s=i[++r])g(s)||!v(s)?o+=" "+s:o+=" "+h(s);return o},r.deprecate=function(t,i){if(void 0!==e&&!0===e.noDeprecation)return t;if(void 0===e)return function(){return r.deprecate(t,i).apply(this,arguments)};var n=!1;return function(){if(!n){if(e.throwDeprecation)throw new Error(i);e.traceDeprecation?console.trace(i):console.error(i),n=!0}return t.apply(this,arguments)}};var a={},o=/^$/;if(e.env.NODE_DEBUG){var s=e.env.NODE_DEBUG;s=s.replace(/[|\\{}()[\]^$+?.]/g,"\\$&").replace(/\*/g,".*").replace(/,/g,"$|^").toUpperCase(),o=new RegExp("^"+s+"$","i")}function h(t,e){var i={seen:[],stylize:f};return arguments.length>=3&&(i.depth=arguments[2]),arguments.length>=4&&(i.colors=arguments[3]),m(e)?i.showHidden=e:e&&r._extend(i,e),y(i.showHidden)&&(i.showHidden=!1),y(i.depth)&&(i.depth=2),y(i.colors)&&(i.colors=!1),y(i.customInspect)&&(i.customInspect=!0),i.colors&&(i.stylize=l),u(i,t,i.depth)}function l(t,e){var r=h.styles[e];return r?"["+h.colors[r][0]+"m"+t+"["+h.colors[r][1]+"m":t}function f(t,e){return t}function u(t,e,i){if(t.customInspect&&e&&k(e.inspect)&&e.inspect!==r.inspect&&(!e.constructor||e.constructor.prototype!==e)){var n=e.inspect(i,t);return _(n)||(n=u(t,n,i)),n}var a=function(t,e){if(y(e))return t.stylize("undefined","undefined");if(_(e)){var r="'"+JSON.stringify(e).replace(/^"|"$/g,"").replace(/'/g,"\\'").replace(/\\"/g,'"')+"'";return t.stylize(r,"string")}return b(e)?t.stylize(""+e,"number"):m(e)?t.stylize(""+e,"boolean"):g(e)?t.stylize("null","null"):void 0}(t,e);if(a)return a;var o=Object.keys(e),s=function(t){var e={};return t.forEach((function(t,r){e[t]=!0})),e}(o);if(t.showHidden&&(o=Object.getOwnPropertyNames(e)),E(e)&&(o.indexOf("message")>=0||o.indexOf("description")>=0))return c(e);if(0===o.length){if(k(e)){var h=e.name?": "+e.name:"";return t.stylize("[Function"+h+"]","special")}if(w(e))return t.stylize(RegExp.prototype.toString.call(e),"regexp");if(x(e))return t.stylize(Date.prototype.toString.call(e),"date");if(E(e))return c(e)}var l,f="",v=!1,S=["{","}"];return p(e)&&(v=!0,S=["[","]"]),k(e)&&(f=" [Function"+(e.name?": "+e.name:"")+"]"),w(e)&&(f=" "+RegExp.prototype.toString.call(e)),x(e)&&(f=" "+Date.prototype.toUTCString.call(e)),E(e)&&(f=" "+c(e)),0!==o.length||v&&0!=e.length?i<0?w(e)?t.stylize(RegExp.prototype.toString.call(e),"regexp"):t.stylize("[Object]","special"):(t.seen.push(e),l=v?function(t,e,r,i,n){for(var a=[],o=0,s=e.length;o<s;++o)I(e,String(o))?a.push(d(t,e,r,i,String(o),!0)):a.push("");return n.forEach((function(n){n.match(/^\d+$/)||a.push(d(t,e,r,i,n,!0))})),a}(t,e,i,s,o):o.map((function(r){return d(t,e,i,s,r,v)})),t.seen.pop(),function(t,e,r){return t.reduce((function(t,e){return e.indexOf("\n"),t+e.replace(/\u001b\[\d\d?m/g,"").length+1}),0)>60?r[0]+(""===e?"":e+"\n ")+" "+t.join(",\n  ")+" "+r[1]:r[0]+e+" "+t.join(", ")+" "+r[1]}(l,f,S)):S[0]+f+S[1]}function c(t){return"["+Error.prototype.toString.call(t)+"]"}function d(t,e,r,i,n,a){var o,s,h;if((h=Object.getOwnPropertyDescriptor(e,n)||{value:e[n]}).get?s=h.set?t.stylize("[Getter/Setter]","special"):t.stylize("[Getter]","special"):h.set&&(s=t.stylize("[Setter]","special")),I(i,n)||(o="["+n+"]"),s||(t.seen.indexOf(h.value)<0?(s=g(r)?u(t,h.value,null):u(t,h.value,r-1)).indexOf("\n")>-1&&(s=a?s.split("\n").map((function(t){return"  "+t})).join("\n").substr(2):"\n"+s.split("\n").map((function(t){return"   "+t})).join("\n")):s=t.stylize("[Circular]","special")),y(o)){if(a&&n.match(/^\d+$/))return s;(o=JSON.stringify(""+n)).match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)?(o=o.substr(1,o.length-2),o=t.stylize(o,"name")):(o=o.replace(/'/g,"\\'").replace(/\\"/g,'"').replace(/(^"|"$)/g,"'"),o=t.stylize(o,"string"))}return o+": "+s}function p(t){return Array.isArray(t)}function m(t){return"boolean"==typeof t}function g(t){return null===t}function b(t){return"number"==typeof t}function _(t){return"string"==typeof t}function y(t){return void 0===t}function w(t){return v(t)&&"[object RegExp]"===S(t)}function v(t){return"object"==typeof t&&null!==t}function x(t){return v(t)&&"[object Date]"===S(t)}function E(t){return v(t)&&("[object Error]"===S(t)||t instanceof Error)}function k(t){return"function"==typeof t}function S(t){return Object.prototype.toString.call(t)}function M(t){return t<10?"0"+t.toString(10):t.toString(10)}r.debuglog=function(t){if(t=t.toUpperCase(),!a[t])if(o.test(t)){var i=e.pid;a[t]=function(){var e=r.format.apply(r,arguments);console.error("%s %d: %s",t,i,e)}}else a[t]=function(){};return a[t]},r.inspect=h,h.colors={bold:[1,22],italic:[3,23],underline:[4,24],inverse:[7,27],white:[37,39],grey:[90,39],black:[30,39],blue:[34,39],cyan:[36,39],green:[32,39],magenta:[35,39],red:[31,39],yellow:[33,39]},h.styles={special:"cyan",number:"yellow",boolean:"yellow",undefined:"grey",null:"bold",string:"green",date:"magenta",regexp:"red"},r.types=t("./support/types"),r.isArray=p,r.isBoolean=m,r.isNull=g,r.isNullOrUndefined=function(t){return null==t},r.isNumber=b,r.isString=_,r.isSymbol=function(t){return"symbol"==typeof t},r.isUndefined=y,r.isRegExp=w,r.types.isRegExp=w,r.isObject=v,r.isDate=x,r.types.isDate=x,r.isError=E,r.types.isNativeError=E,r.isFunction=k,r.isPrimitive=function(t){return null===t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||"symbol"==typeof t||void 0===t},r.isBuffer=t("./support/isBuffer");var A=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function I(t,e){return Object.prototype.hasOwnProperty.call(t,e)}r.log=function(){var t,e;console.log("%s - %s",(t=new Date,e=[M(t.getHours()),M(t.getMinutes()),M(t.getSeconds())].join(":"),[t.getDate(),A[t.getMonth()],e].join(" ")),r.format.apply(r,arguments))},r.inherits=t("inherits"),r._extend=function(t,e){if(!e||!v(e))return t;for(var r=Object.keys(e),i=r.length;i--;)t[r[i]]=e[r[i]];return t};var B="undefined"!=typeof Symbol?Symbol("util.promisify.custom"):void 0;function T(t,e){if(!t){var r=new Error("Promise was rejected with a falsy value");r.reason=t,t=r}return e(t)}r.promisify=function(t){if("function"!=typeof t)throw new TypeError('The "original" argument must be of type Function');if(B&&t[B]){var e;if("function"!=typeof(e=t[B]))throw new TypeError('The "util.promisify.custom" argument must be of type Function');return Object.defineProperty(e,B,{value:e,enumerable:!1,writable:!1,configurable:!0}),e}function e(){for(var e,r,i=new Promise((function(t,i){e=t,r=i})),n=[],a=0;a<arguments.length;a++)n.push(arguments[a]);n.push((function(t,i){t?r(t):e(i)}));try{t.apply(this,n)}catch(t){r(t)}return i}return Object.setPrototypeOf(e,Object.getPrototypeOf(t)),B&&Object.defineProperty(e,B,{value:e,enumerable:!1,writable:!1,configurable:!0}),Object.defineProperties(e,i(t))},r.promisify.custom=B,r.callbackify=function(t){if("function"!=typeof t)throw new TypeError('The "original" argument must be of type Function');function r(){for(var r=[],i=0;i<arguments.length;i++)r.push(arguments[i]);var n=r.pop();if("function"!=typeof n)throw new TypeError("The last argument must be of type Function");var a=this,o=function(){return n.apply(a,arguments)};t.apply(this,r).then((function(t){e.nextTick(o.bind(null,null,t))}),(function(t){e.nextTick(T.bind(null,t,o))}))}return Object.setPrototypeOf(r,Object.getPrototypeOf(t)),Object.defineProperties(r,i(t)),r}}).call(this)}).call(this,t("_process"))},{"./support/isBuffer":79,"./support/types":80,_process:60,inherits:45}],82:[function(t,e,i){(function(r){(function(){"use strict";var i=t("foreach"),n=t("available-typed-arrays"),a=t("es-abstract/helpers/callBound"),o=a("Object.prototype.toString"),s=t("has-symbols")()&&"symbol"==typeof Symbol.toStringTag,h=n(),l=a("String.prototype.slice"),f={},u=t("es-abstract/helpers/getOwnPropertyDescriptor"),c=Object.getPrototypeOf;s&&u&&c&&i(h,(function(t){if("function"==typeof r[t]){var e=new r[t];if(!(Symbol.toStringTag in e))throw new EvalError("this engine has support for Symbol.toStringTag, but "+t+" does not have the property! Please report this.");var i=c(e),n=u(i,Symbol.toStringTag);if(!n){var a=c(i);n=u(a,Symbol.toStringTag)}f[t]=n.get}}));var d=t("is-typed-array");e.exports=function(t){return!!d(t)&&(s?function(t){var e=!1;return i(f,(function(r,i){if(!e)try{var n=r.call(t);n===i&&(e=n)}catch(t){}})),e}(t):l(o(t),8,-1))}}).call(this)}).call(this,void 0!==r.g?r.g:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"available-typed-arrays":27,"es-abstract/helpers/callBound":36,"es-abstract/helpers/getOwnPropertyDescriptor":37,foreach:39,"has-symbols":42,"is-typed-array":48}]},{},[20])(20)},4406:t=>{var e=t.exports={};e.nextTick=function(){var t="undefined"!=typeof window&&window.setImmediate,e="undefined"!=typeof window&&window.postMessage&&window.addEventListener;if(t)return function(t){return window.setImmediate(t)};if(e){var r=[];return window.addEventListener("message",(function(t){var e=t.source;e!==window&&null!==e||"process-tick"!==t.data||(t.stopPropagation(),r.length>0&&r.shift()())}),!0),function(t){r.push(t),window.postMessage("process-tick","*")}}return function(t){setTimeout(t,0)}}(),e.title="browser",e.browser=!0,e.env={},e.argv=[],e.binding=function(t){throw new Error("process.binding is not supported")},e.cwd=function(){return"/"},e.chdir=function(t){throw new Error("process.chdir is not supported")}},6197:(t,e,r)=>{"use strict";var i=r(8834).lW;Object.defineProperty(e,"__esModule",{value:!0}),e.AbstractTokenizer=void 0;const n=r(4644);e.AbstractTokenizer=class{constructor(t){this.position=0,this.numBuffer=new Uint8Array(8),this.fileInfo=t||{}}async readToken(t,e=this.position){const r=i.alloc(t.len);if(await this.readBuffer(r,{position:e})<t.len)throw new n.EndOfStreamError;return t.get(r,0)}async peekToken(t,e=this.position){const r=i.alloc(t.len);if(await this.peekBuffer(r,{position:e})<t.len)throw new n.EndOfStreamError;return t.get(r,0)}async readNumber(t){if(await this.readBuffer(this.numBuffer,{length:t.len})<t.len)throw new n.EndOfStreamError;return t.get(this.numBuffer,0)}async peekNumber(t){if(await this.peekBuffer(this.numBuffer,{length:t.len})<t.len)throw new n.EndOfStreamError;return t.get(this.numBuffer,0)}async ignore(t){if(void 0!==this.fileInfo.size){const e=this.fileInfo.size-this.position;if(t>e)return this.position+=e,e}return this.position+=t,t}async close(){}normalizeOptions(t,e){if(e&&void 0!==e.position&&e.position<this.position)throw new Error("`options.position` must be equal or greater than `tokenizer.position`");return e?{mayBeLess:!0===e.mayBeLess,offset:e.offset?e.offset:0,length:e.length?e.length:t.length-(e.offset?e.offset:0),position:e.position?e.position:this.position}:{mayBeLess:!1,offset:0,length:t.length,position:this.position}}}},932:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.BufferTokenizer=void 0;const i=r(4644),n=r(6197);class a extends n.AbstractTokenizer{constructor(t,e){super(e),this.uint8Array=t,this.fileInfo.size=this.fileInfo.size?this.fileInfo.size:t.length}async readBuffer(t,e){if(e&&e.position){if(e.position<this.position)throw new Error("`options.position` must be equal or greater than `tokenizer.position`");this.position=e.position}const r=await this.peekBuffer(t,e);return this.position+=r,r}async peekBuffer(t,e){const r=this.normalizeOptions(t,e),n=Math.min(this.uint8Array.length-r.position,r.length);if(!r.mayBeLess&&n<r.length)throw new i.EndOfStreamError;return t.set(this.uint8Array.subarray(r.position,r.position+n),r.offset),n}async close(){}}e.BufferTokenizer=a},9425:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.fromFile=e.FileTokenizer=void 0;const i=r(6197),n=r(4644),a=r(5187);class o extends i.AbstractTokenizer{constructor(t,e){super(e),this.fd=t}async readBuffer(t,e){const r=this.normalizeOptions(t,e);this.position=r.position;const i=await a.read(this.fd,t,r.offset,r.length,r.position);if(this.position+=i.bytesRead,i.bytesRead<r.length&&(!e||!e.mayBeLess))throw new n.EndOfStreamError;return i.bytesRead}async peekBuffer(t,e){const r=this.normalizeOptions(t,e),i=await a.read(this.fd,t,r.offset,r.length,r.position);if(!r.mayBeLess&&i.bytesRead<r.length)throw new n.EndOfStreamError;return i.bytesRead}async close(){return a.close(this.fd)}}e.FileTokenizer=o,e.fromFile=async function(t){const e=await a.stat(t);if(!e.isFile)throw new Error(`File not a file: ${t}`);const r=await a.open(t,"r");return new o(r,{path:t,size:e.size})}},5187:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.readFile=e.writeFileSync=e.writeFile=e.read=e.open=e.close=e.stat=e.createReadStream=e.pathExists=void 0;const i=r(6777);e.pathExists=i.existsSync,e.createReadStream=i.createReadStream,e.stat=async function(t){return new Promise(((e,r)=>{i.stat(t,((t,i)=>{t?r(t):e(i)}))}))},e.close=async function(t){return new Promise(((e,r)=>{i.close(t,(t=>{t?r(t):e()}))}))},e.open=async function(t,e){return new Promise(((r,n)=>{i.open(t,e,((t,e)=>{t?n(t):r(e)}))}))},e.read=async function(t,e,r,n,a){return new Promise(((o,s)=>{i.read(t,e,r,n,a,((t,e,r)=>{t?s(t):o({bytesRead:e,buffer:r})}))}))},e.writeFile=async function(t,e){return new Promise(((r,n)=>{i.writeFile(t,e,(t=>{t?n(t):r()}))}))},e.writeFileSync=function(t,e){i.writeFileSync(t,e)},e.readFile=async function(t){return new Promise(((e,r)=>{i.readFile(t,((t,i)=>{t?r(t):e(i)}))}))}},8286:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.ReadStreamTokenizer=void 0;const i=r(6197),n=r(4644);class a extends i.AbstractTokenizer{constructor(t,e){super(e),this.streamReader=new n.StreamReader(t)}async getFileInfo(){return this.fileInfo}async readBuffer(t,e){const r=this.normalizeOptions(t,e),i=r.position-this.position;if(i>0)return await this.ignore(i),this.readBuffer(t,e);if(i<0)throw new Error("`options.position` must be equal or greater than `tokenizer.position`");if(0===r.length)return 0;const a=await this.streamReader.read(t,r.offset,r.length);if(this.position+=a,(!e||!e.mayBeLess)&&a<r.length)throw new n.EndOfStreamError;return a}async peekBuffer(t,e){const r=this.normalizeOptions(t,e);let i=0;if(r.position){const e=r.position-this.position;if(e>0){const n=new Uint8Array(r.length+e);return i=await this.peekBuffer(n,{mayBeLess:r.mayBeLess}),t.set(n.subarray(e),r.offset),i-e}if(e<0)throw new Error("Cannot peek from a negative offset in a stream")}if(r.length>0){try{i=await this.streamReader.peek(t,r.offset,r.length)}catch(t){if(e&&e.mayBeLess&&t instanceof n.EndOfStreamError)return 0;throw t}if(!r.mayBeLess&&i<r.length)throw new n.EndOfStreamError}return i}async ignore(t){const e=Math.min(256e3,t),r=new Uint8Array(e);let i=0;for(;i<t;){const n=t-i,a=await this.readBuffer(r,{length:Math.min(e,n)});if(a<0)return a;i+=a}return i}}e.ReadStreamTokenizer=a},7378:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.fromBuffer=e.fromStream=e.EndOfStreamError=void 0;const i=r(8286),n=r(932);var a=r(4644);Object.defineProperty(e,"EndOfStreamError",{enumerable:!0,get:function(){return a.EndOfStreamError}}),e.fromStream=function(t,e){return e=e||{},new i.ReadStreamTokenizer(t,e)},e.fromBuffer=function(t,e){return new n.BufferTokenizer(t,e)}},3569:(t,e,r)=>{"use strict";Object.defineProperty(e,"__esModule",{value:!0}),e.fromStream=e.fromBuffer=e.EndOfStreamError=e.fromFile=void 0;const i=r(5187),n=r(7378);var a=r(9425);Object.defineProperty(e,"fromFile",{enumerable:!0,get:function(){return a.fromFile}});var o=r(7378);Object.defineProperty(e,"EndOfStreamError",{enumerable:!0,get:function(){return o.EndOfStreamError}}),Object.defineProperty(e,"fromBuffer",{enumerable:!0,get:function(){return o.fromBuffer}}),e.fromStream=async function(t,e){if(e=e||{},t.path){const r=await i.stat(t.path);e.path=t.path,e.size=r.size}return n.fromStream(t,e)}},643:(t,e)=>{"use strict";var r="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t};e.Ee=function(t,e,r,i,n,a){for(var o=arguments.length,h=Array(o>6?o-6:0),l=6;l<o;l++)h[l-6]=arguments[l];return h.length?s.call.apply(s,[null,!1,!0,t,e,r,i,n,a].concat(h)):s(!1,!0,t,e,r,i,n,a)};var i="INVALID_ARGS";function n(t){throw new Error(t)}function a(t){var e=Object.keys(t);return Object.getOwnPropertySymbols?e.concat(Object.getOwnPropertySymbols(t)):e}function o(t){if(Array.isArray(t))return t.slice();for(var e=a(t),r={},i=0;i<e.length;i++){var n=e[i];r[n]=t[n]}return r}function s(t,e,r){var l=r;null==l&&n(i);for(var f=!1,u=arguments.length,c=Array(u>3?u-3:0),d=3;d<u;d++)c[d-3]=arguments[d];for(var p=0;p<c.length;p++){var m=c[p];if(null!=m){var g=a(m);if(g.length)for(var b=0;b<=g.length;b++){var _=g[b];if(!t||void 0===l[_]){var y=m[_];e&&h(l[_])&&h(y)&&(y=s(t,e,l[_],y)),void 0!==y&&y!==l[_]&&(f||(f=!0,l=o(l)),l[_]=y)}}}}return l}function h(t){var e=void 0===t?"undefined":r(t);return null!=t&&"object"===e}},5010:(t,e,r)=>{"use strict";var i=r(8834).lW;Object.defineProperty(e,"__esModule",{value:!0}),e.AnsiStringType=e.StringType=e.BufferType=e.Uint8ArrayType=e.IgnoreType=e.Float80_LE=e.Float80_BE=e.Float64_LE=e.Float64_BE=e.Float32_LE=e.Float32_BE=e.Float16_LE=e.Float16_BE=e.INT64_BE=e.UINT64_BE=e.INT64_LE=e.UINT64_LE=e.INT32_LE=e.INT32_BE=e.INT24_BE=e.INT24_LE=e.INT16_LE=e.INT16_BE=e.INT8=e.UINT32_BE=e.UINT32_LE=e.UINT24_BE=e.UINT24_LE=e.UINT16_BE=e.UINT16_LE=e.UINT8=void 0;const n=r(2333);function a(t){return new DataView(t.buffer,t.byteOffset)}e.UINT8={len:1,get:(t,e)=>a(t).getUint8(e),put:(t,e,r)=>(a(t).setUint8(e,r),e+1)},e.UINT16_LE={len:2,get:(t,e)=>a(t).getUint16(e,!0),put:(t,e,r)=>(a(t).setUint16(e,r,!0),e+2)},e.UINT16_BE={len:2,get:(t,e)=>a(t).getUint16(e),put:(t,e,r)=>(a(t).setUint16(e,r),e+2)},e.UINT24_LE={len:3,get(t,e){const r=a(t);return r.getUint8(e)+(r.getUint16(e+1,!0)<<8)},put(t,e,r){const i=a(t);return i.setUint8(e,255&r),i.setUint16(e+1,r>>8,!0),e+3}},e.UINT24_BE={len:3,get(t,e){const r=a(t);return(r.getUint16(e)<<8)+r.getUint8(e+2)},put(t,e,r){const i=a(t);return i.setUint16(e,r>>8),i.setUint8(e+2,255&r),e+3}},e.UINT32_LE={len:4,get:(t,e)=>a(t).getUint32(e,!0),put:(t,e,r)=>(a(t).setUint32(e,r,!0),e+4)},e.UINT32_BE={len:4,get:(t,e)=>a(t).getUint32(e),put:(t,e,r)=>(a(t).setUint32(e,r),e+4)},e.INT8={len:1,get:(t,e)=>a(t).getInt8(e),put:(t,e,r)=>(a(t).setInt8(e,r),e+1)},e.INT16_BE={len:2,get:(t,e)=>a(t).getInt16(e),put:(t,e,r)=>(a(t).setInt16(e,r),e+2)},e.INT16_LE={len:2,get:(t,e)=>a(t).getInt16(e,!0),put:(t,e,r)=>(a(t).setInt16(e,r,!0),e+2)},e.INT24_LE={len:3,get(t,r){const i=e.UINT24_LE.get(t,r);return i>8388607?i-16777216:i},put(t,e,r){const i=a(t);return i.setUint8(e,255&r),i.setUint16(e+1,r>>8,!0),e+3}},e.INT24_BE={len:3,get(t,r){const i=e.UINT24_BE.get(t,r);return i>8388607?i-16777216:i},put(t,e,r){const i=a(t);return i.setUint16(e,r>>8),i.setUint8(e+2,255&r),e+3}},e.INT32_BE={len:4,get:(t,e)=>a(t).getInt32(e),put:(t,e,r)=>(a(t).setInt32(e,r),e+4)},e.INT32_LE={len:4,get:(t,e)=>a(t).getInt32(e,!0),put:(t,e,r)=>(a(t).setInt32(e,r,!0),e+4)},e.UINT64_LE={len:8,get:(t,e)=>a(t).getBigUint64(e,!0),put:(t,e,r)=>(a(t).setBigUint64(e,r,!0),e+8)},e.INT64_LE={len:8,get:(t,e)=>a(t).getBigInt64(e,!0),put:(t,e,r)=>(a(t).setBigInt64(e,r,!0),e+8)},e.UINT64_BE={len:8,get:(t,e)=>a(t).getBigUint64(e),put:(t,e,r)=>(a(t).setBigUint64(e,r),e+8)},e.INT64_BE={len:8,get:(t,e)=>a(t).getBigInt64(e),put:(t,e,r)=>(a(t).setBigInt64(e,r),e+8)},e.Float16_BE={len:2,get(t,e){return n.read(t,e,!1,10,this.len)},put(t,e,r){return n.write(t,r,e,!1,10,this.len),e+this.len}},e.Float16_LE={len:2,get(t,e){return n.read(t,e,!0,10,this.len)},put(t,e,r){return n.write(t,r,e,!0,10,this.len),e+this.len}},e.Float32_BE={len:4,get:(t,e)=>a(t).getFloat32(e),put:(t,e,r)=>(a(t).setFloat32(e,r),e+4)},e.Float32_LE={len:4,get:(t,e)=>a(t).getFloat32(e,!0),put:(t,e,r)=>(a(t).setFloat32(e,r,!0),e+4)},e.Float64_BE={len:8,get:(t,e)=>a(t).getFloat64(e),put:(t,e,r)=>(a(t).setFloat64(e,r),e+8)},e.Float64_LE={len:8,get:(t,e)=>a(t).getFloat64(e,!0),put:(t,e,r)=>(a(t).setFloat64(e,r,!0),e+8)},e.Float80_BE={len:10,get(t,e){return n.read(t,e,!1,63,this.len)},put(t,e,r){return n.write(t,r,e,!1,63,this.len),e+this.len}},e.Float80_LE={len:10,get(t,e){return n.read(t,e,!0,63,this.len)},put(t,e,r){return n.write(t,r,e,!0,63,this.len),e+this.len}},e.IgnoreType=class{constructor(t){this.len=t}get(t,e){}},e.Uint8ArrayType=class{constructor(t){this.len=t}get(t,e){return t.subarray(e,e+this.len)}},e.BufferType=class{constructor(t){this.len=t}get(t,e){return i.from(t.subarray(e,e+this.len))}},e.StringType=class{constructor(t,e){this.len=t,this.encoding=e}get(t,e){return i.from(t).toString(this.encoding,e,e+this.len)}};class o{constructor(t){this.len=t}static decode(t,e,r){let i="";for(let n=e;n<r;++n)i+=o.codePointToString(o.singleByteDecoder(t[n]));return i}static inRange(t,e,r){return e<=t&&t<=r}static codePointToString(t){return t<=65535?String.fromCharCode(t):(t-=65536,String.fromCharCode(55296+(t>>10),56320+(1023&t)))}static singleByteDecoder(t){if(o.inRange(t,0,127))return t;const e=o.windows1252[t-128];if(null===e)throw Error("invaliding encoding");return e}get(t,e=0){return o.decode(t,e,e+this.len)}}e.AnsiStringType=o,o.windows1252=[8364,129,8218,402,8222,8230,8224,8225,710,8240,352,8249,338,141,381,143,144,8216,8217,8220,8221,8226,8211,8212,732,8482,353,8250,339,157,382,376,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255]},311:(t,e)=>{(e=t.exports=function(t){return t.replace(/^\s*|\s*$/g,"")}).left=function(t){return t.replace(/^\s*/,"")},e.right=function(t){return t.replace(/\s*$/,"")}},9299:(t,e,r)=>{var i=r(4406);!function(){var e={};function n(){void 0===i&&console.log.apply(console,arguments)}t.exports=e,function(t,e){var r,i,a,o,s,h,l,f,u,c,d,p,m,g,b;!function(){"use strict";var e=function(){function t(t){this.message="JPEG error: "+t}return t.prototype=new Error,t.prototype.name="JpegError",t.constructor=t,t}(),r=function(){var t=new Uint8Array([0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]),r=4017,n=799,a=3406,o=2276,s=1567,h=3784,l=5793,f=2896;function u(t){null==t&&(t={}),null==t.w&&(t.w=-1),this.V=t.n,this.N=t.w}function c(t,e){for(var r,i,n,a=0,o=[],s=16;s>0&&!t[s-1];)s--;o.push({children:[],index:0});var h=o[0];for(r=0;r<s;r++){for(i=0;i<t[r];i++){for((h=o.pop()).children[h.index]=e[a];h.index>0;)h=o.pop();for(h.index++,o.push(h);o.length<=r;)o.push(n={children:[],index:0}),h.children[h.index]=n.children,h=n;a++}r+1<s&&(o.push(n={children:[],index:0}),h.children[h.index]=n.children,h=n)}return o[0].children}function d(t,e,r){return 64*((t.P+1)*e+r)}function p(r,n,a,o,s,h,l,f,u,c){null==c&&(c=!1);var p,m,g,_,y,w,v,x,E,k,S,M=a.m,A=a.Z,I=n,B=0,T=0,R=0,P=0,O=0,L=0;function C(){if(T>0)return T--,B>>T&1;if(255===(B=r[n++])){var t=r[n++];if(t){if(220===t&&c){var o=i(r,n+=2);if(n+=2,o>0&&o!==a.s)throw new DNLMarkerError("Found DNL marker (0xFFDC) while parsing scan data",o)}else if(217===t){if(c){var s=8*O;if(s>0&&s<a.s/10)throw new DNLMarkerError("Found EOI marker (0xFFD9) while parsing scan data, possibly caused by incorrect `scanLines` parameter",s)}throw new EOIMarkerError("Found EOI marker (0xFFD9) while parsing scan data")}throw new e("unexpected marker")}}return T=7,B>>>7}function U(t){for(var r=t;;){switch(typeof(r=r[C()])){case"number":return r;case"object":continue}throw new e("invalid huffman sequence")}}function z(t){for(var e=0;t>0;)e=e<<1|C(),t--;return e}function D(t){if(1===t)return 1===C()?1:-1;var e=z(t);return e>=1<<t-1?e:e+(-1<<t)+1}function N(t,e,r,i,n){var a=r%M;O=(r/M|0)*t.A+i;var o=a*t.h+n;e(t,d(t,O,o))}function F(t,e,r){O=r/t.P|0;var i=r%t.P;e(t,d(t,O,i))}var j=o.length;for(v=A?0===h?0===f?function(t,e){var r=U(t.J),i=0===r?0:D(r)<<u;t.D[e]=t.Q+=i}:function(t,e){t.D[e]|=C()<<u}:0===f?function(e,r){if(R>0)R--;else for(var i=h,n=l;i<=n;){var a=U(e.i),o=15&a,s=a>>4;if(0!==o){var f=t[i+=s];e.D[r+f]=D(o)*(1<<u),i++}else{if(s<15){R=z(s)+(1<<s)-1;break}i+=16}}}:function(r,i){for(var n,a,o=h,s=l,f=0;o<=s;){var c=i+t[o],d=r.D[c]<0?-1:1;switch(P){case 0:if(f=(a=U(r.i))>>4,0==(n=15&a))f<15?(R=z(f)+(1<<f),P=4):(f=16,P=1);else{if(1!==n)throw new e("invalid ACn encoding");p=D(n),P=f?2:3}continue;case 1:case 2:r.D[c]?r.D[c]+=d*(C()<<u):0==--f&&(P=2===P?3:0);break;case 3:r.D[c]?r.D[c]+=d*(C()<<u):(r.D[c]=p<<u,P=0);break;case 4:r.D[c]&&(r.D[c]+=d*(C()<<u))}o++}4===P&&0==--R&&(P=0)}:function(e,r){var i=U(e.J),n=0===i?0:D(i),a=1;for(e.D[r]=e.Q+=n;a<64;){var o=U(e.i),s=15&o,h=o>>4;if(0!==s){var l=t[a+=h];e.D[r+l]=D(s),a++}else{if(h<15)break;a+=16}}},E=1===j?o[0].P*o[0].c:M*a.R;L<=E;){var G=s?Math.min(E-L,s):E;if(G>0){for(g=0;g<j;g++)o[g].Q=0;if(R=0,1===j)for(m=o[0],w=0;w<G;w++)F(m,v,L),L++;else for(w=0;w<G;w++){for(g=0;g<j;g++)for(k=(m=o[g]).h,S=m.A,_=0;_<S;_++)for(y=0;y<k;y++)N(m,v,L,_,y);L++}}if(T=0,!(x=b(r,n)))break;if(x.u&&(n=x.offset),!(x.M>=65488&&x.M<=65495))break;n+=2}return n-I}function m(t,i,u){var c,d,p,m,g,b,_,y,w,v,x,E,k,S,M,A,I,B=t.$,T=t.D;if(!B)throw new e("missing required Quantization Table.");for(var R=0;R<64;R+=8)w=T[i+R],v=T[i+R+1],x=T[i+R+2],E=T[i+R+3],k=T[i+R+4],S=T[i+R+5],M=T[i+R+6],A=T[i+R+7],w*=B[R],0!=(v|x|E|k|S|M|A)?(v*=B[R+1],x*=B[R+2],E*=B[R+3],k*=B[R+4],S*=B[R+5],M*=B[R+6],A*=B[R+7],d=(c=(c=l*w+128>>8)+(d=l*k+128>>8)+1>>1)-d,I=(p=x)*h+(m=M)*s+128>>8,p=p*s-m*h+128>>8,_=(g=(g=f*(v-A)+128>>8)+(_=S<<4)+1>>1)-_,b=(y=(y=f*(v+A)+128>>8)+(b=E<<4)+1>>1)-b,m=(c=c+(m=I)+1>>1)-m,p=(d=d+p+1>>1)-p,I=g*o+y*a+2048>>12,g=g*a-y*o+2048>>12,y=I,I=b*n+_*r+2048>>12,b=b*r-_*n+2048>>12,_=I,u[R]=c+y,u[R+7]=c-y,u[R+1]=d+_,u[R+6]=d-_,u[R+2]=p+b,u[R+5]=p-b,u[R+3]=m+g,u[R+4]=m-g):(I=l*w+512>>10,u[R]=I,u[R+1]=I,u[R+2]=I,u[R+3]=I,u[R+4]=I,u[R+5]=I,u[R+6]=I,u[R+7]=I);for(var P=0;P<8;++P)w=u[P],0!=((v=u[P+8])|(x=u[P+16])|(E=u[P+24])|(k=u[P+32])|(S=u[P+40])|(M=u[P+48])|(A=u[P+56]))?(d=(c=4112+((c=l*w+2048>>12)+(d=l*k+2048>>12)+1>>1))-d,I=(p=x)*h+(m=M)*s+2048>>12,p=p*s-m*h+2048>>12,m=I,_=(g=(g=f*(v-A)+2048>>12)+(_=S)+1>>1)-_,b=(y=(y=f*(v+A)+2048>>12)+(b=E)+1>>1)-b,I=g*o+y*a+2048>>12,g=g*a-y*o+2048>>12,y=I,I=b*n+_*r+2048>>12,b=b*r-_*n+2048>>12,(w=(c=c+m+1>>1)+y)<16?w=0:w>=4080?w=255:w>>=4,(v=(d=d+p+1>>1)+(_=I))<16?v=0:v>=4080?v=255:v>>=4,(x=(p=d-p)+b)<16?x=0:x>=4080?x=255:x>>=4,(E=(m=c-m)+g)<16?E=0:E>=4080?E=255:E>>=4,(k=m-g)<16?k=0:k>=4080?k=255:k>>=4,(S=p-b)<16?S=0:S>=4080?S=255:S>>=4,(M=d-_)<16?M=0:M>=4080?M=255:M>>=4,(A=c-y)<16?A=0:A>=4080?A=255:A>>=4,T[i+P]=w,T[i+P+8]=v,T[i+P+16]=x,T[i+P+24]=E,T[i+P+32]=k,T[i+P+40]=S,T[i+P+48]=M,T[i+P+56]=A):(I=(I=l*w+8192>>14)<-2040?0:I>=2024?255:I+2056>>4,T[i+P]=I,T[i+P+8]=I,T[i+P+16]=I,T[i+P+24]=I,T[i+P+32]=I,T[i+P+40]=I,T[i+P+48]=I,T[i+P+56]=I)}function g(t,e){for(var r=e.P,i=e.c,n=new Int16Array(64),a=0;a<i;a++)for(var o=0;o<r;o++)m(e,d(e,a,o),n);return e.D}function b(t,e,r){null==r&&(r=e);var n=t.length-1,a=r<e?r:e;if(e>=n)return null;var o=i(t,e);if(o>=65472&&o<=65534)return{u:null,M:o,offset:e};for(var s=i(t,a);!(s>=65472&&s<=65534);){if(++a>=n)return null;s=i(t,a)}return{u:o.toString(16),M:s,offset:a}}return u.prototype={parse(r,n){null==n&&(n={});var a,o,s=n.F,h=0,l=null,f=null,u=0;function d(){var t=i(r,h),e=(h+=2)+t-2,n=b(r,e,h);n&&n.u&&(e=n.offset);var a=r.subarray(h,e);return h+=a.length,a}function m(t){for(var e=Math.ceil(t.o/8/t.X),r=Math.ceil(t.s/8/t.B),i=0;i<t.W.length;i++){G=t.W[i];var n=Math.ceil(Math.ceil(t.o/8)*G.h/t.X),a=Math.ceil(Math.ceil(t.s/8)*G.A/t.B),o=e*G.h,s=r*G.A*64*(o+1);G.D=new Int16Array(s),G.P=n,G.c=a}t.m=e,t.R=r}var _=[],y=[],w=[],v=i(r,h);if(h+=2,65496!==v)throw new e("SOI not found");v=i(r,h),h+=2;t:for(;65497!==v;){var x,E,k;switch(v){case 65504:case 65505:case 65506:case 65507:case 65508:case 65509:case 65510:case 65511:case 65512:case 65513:case 65514:case 65515:case 65516:case 65517:case 65518:case 65519:case 65534:var S=d();65504===v&&74===S[0]&&70===S[1]&&73===S[2]&&70===S[3]&&0===S[4]&&(l={version:{d:S[5],T:S[6]},K:S[7],j:S[8]<<8|S[9],H:S[10]<<8|S[11],S:S[12],I:S[13],C:S.subarray(14,14+3*S[12]*S[13])}),65518===v&&65===S[0]&&100===S[1]&&111===S[2]&&98===S[3]&&101===S[4]&&(f={version:S[5]<<8|S[6],k:S[7]<<8|S[8],q:S[9]<<8|S[10],a:S[11]});break;case 65499:for(var M=i(r,h)+(h+=2)-2;h<M;){var A=r[h++],I=new Uint16Array(64);if(A>>4==0)for(E=0;E<64;E++)I[t[E]]=r[h++];else{if(A>>4!=1)throw new e("DQT - invalid table spec");for(E=0;E<64;E++)I[t[E]]=i(r,h),h+=2}_[15&A]=I}break;case 65472:case 65473:case 65474:if(a)throw new e("Only single frame JPEGs supported");h+=2,(a={}).G=65473===v,a.Z=65474===v,a.precision=r[h++];var B,T=i(r,h),R=0,P=0;h+=2,a.s=s||T,a.o=i(r,h),h+=2,a.W=[],a._={};var O=r[h++];for(x=0;x<O;x++){B=r[h];var L=r[h+1]>>4,C=15&r[h+1];R<L&&(R=L),P<C&&(P=C);var U=r[h+2];k=a.W.push({h:L,A:C,L:U,$:null}),a._[B]=k-1,h+=3}a.X=R,a.B=P,m(a);break;case 65476:var z=i(r,h);for(h+=2,x=2;x<z;){var D=r[h++],N=new Uint8Array(16),F=0;for(E=0;E<16;E++,h++)F+=N[E]=r[h];var j=new Uint8Array(F);for(E=0;E<F;E++,h++)j[E]=r[h];x+=17+F,(D>>4==0?w:y)[15&D]=c(N,j)}break;case 65501:o=i(r,h+=2),h+=2;break;case 65498:var G,H=1==++u&&!s;h+=2;var W=r[h++],q=[];for(x=0;x<W;x++){var Z=r[h++],Y=a._[Z];(G=a.W[Y]).index=Z;var V=r[h++];G.J=w[V>>4],G.i=y[15&V],q.push(G)}var X=r[h++],J=r[h++],Q=r[h++];try{var K=p(r,h,a,q,o,X,J,Q>>4,15&Q,H);h+=K}catch(t){if(t instanceof DNLMarkerError)return this.parse(r,{F:t.s});if(t instanceof EOIMarkerError)break t;throw t}break;case 65500:h+=4;break;case 65535:255!==r[h]&&h--;break;default:var $=b(r,h-2,h-3);if($&&$.u){h=$.offset;break}if(h>=r.length-1)break t;throw new e("JpegImage.parse - unknown marker: "+v.toString(16))}v=i(r,h),h+=2}for(this.width=a.o,this.height=a.s,this.g=l,this.b=f,this.W=[],x=0;x<a.W.length;x++){var tt=_[(G=a.W[x]).L];tt&&(G.$=tt),this.W.push({index:G.index,e:g(0,G),l:G.h/a.X,t:G.A/a.B,P:G.P,c:G.c})}this.p=this.W.length},Y(t,e,r){null==r&&(r=!1);var i,n,a,o,s,h,l,f,u,c,d,p,m=this.width/t,g=this.height/e,b=0,_=this.W.length,y=t*e*_,w=new Uint8ClampedArray(y),v=new Uint32Array(t),x=4294967288;for(l=0;l<_;l++){if(n=(i=this.W[l]).l*m,a=i.t*g,b=l,d=i.e,o=i.P+1<<3,n!==p){for(s=0;s<t;s++)f=0|s*n,v[s]=(f&x)<<3|7&f;p=n}for(h=0;h<e;h++)for(c=o*((f=0|h*a)&x)|(7&f)<<3,s=0;s<t;s++)w[b]=d[c+v[s]],b+=_}var E=this.V;if(r||4!==_||E||(E=new Int32Array([-256,255,-256,255,-256,255,-256,255])),E)for(l=0;l<y;)for(f=0,u=0;f<_;f++,l++,u+=2)w[l]=(w[l]*E[u]>>8)+E[u+1];return w},get f(){return this.b?!!this.b.a:3===this.p?0!==this.N&&(82!==this.W[0].index||71!==this.W[1].index||66!==this.W[2].index):1===this.N},z:function(t){for(var e,r,i,n=0,a=t.length;n<a;n+=3)e=t[n],r=t[n+1],i=t[n+2],t[n]=e-179.456+1.402*i,t[n+1]=e+135.459-.344*r-.714*i,t[n+2]=e-226.816+1.772*r;return t},O:function(t){for(var e,r,i,n,a=0,o=0,s=t.length;o<s;o+=4)e=t[o],r=t[o+1],i=t[o+2],n=t[o+3],t[a++]=r*(-660635669420364e-19*r+.000437130475926232*i-54080610064599e-18*e+.00048449797120281*n-.154362151871126)-122.67195406894+i*(-.000957964378445773*i+.000817076911346625*e-.00477271405408747*n+1.53380253221734)+e*(.000961250184130688*e-.00266257332283933*n+.48357088451265)+n*(-.000336197177618394*n+.484791561490776),t[a++]=107.268039397724+r*(219927104525741e-19*r-.000640992018297945*i+.000659397001245577*e+.000426105652938837*n-.176491792462875)+i*(-.000778269941513683*i+.00130872261408275*e+.000770482631801132*n-.151051492775562)+e*(.00126935368114843*e-.00265090189010898*n+.25802910206845)+n*(-.000318913117588328*n-.213742400323665),t[a++]=r*(-.000570115196973677*r-263409051004589e-19*i+.0020741088115012*e-.00288260236853442*n+.814272968359295)-20.810012546947+i*(-153496057440975e-19*i-.000132689043961446*e+.000560833691242812*n-.195152027534049)+e*(.00174418132927582*e-.00255243321439347*n+.116935020465145)+n*(-.000343531996510555*n+.24165260232407);return t.subarray(0,a)},r:function(t){for(var e,r,i,n=0,a=t.length;n<a;n+=4)e=t[n],r=t[n+1],i=t[n+2],t[n]=434.456-e-1.402*i,t[n+1]=119.541-e+.344*r+.714*i,t[n+2]=481.816-e-1.772*r;return t},U:function(t){for(var e,r,i,n,a=0,o=0,s=t.length;o<s;o+=4)e=t[o],r=t[o+1],i=t[o+2],n=t[o+3],t[a++]=255+e*(-6747147073602441e-20*e+.0008379262121013727*r+.0002894718188643294*i+.003264231057537806*n-1.1185611867203937)+r*(26374107616089405e-21*r-8626949158638572e-20*i-.0002748769067499491*n-.02155688794978967)+i*(-3878099212869363e-20*i-.0003267808279485286*n+.0686742238595345)-n*(.0003361971776183937*n+.7430659151342254),t[a++]=255+e*(.00013596372813588848*e+.000924537132573585*r+.00010567359618683593*i+.0004791864687436512*n-.3109689587515875)+r*(-.00023545346108370344*r+.0002702845253534714*i+.0020200308977307156*n-.7488052167015494)+i*(6834815998235662e-20*i+.00015168452363460973*n-.09751927774728933)-n*(.0003189131175883281*n+.7364883807733168),t[a++]=255+e*(13598650411385307e-21*e+.00012423956175490851*r+.0004751985097583589*i-36729317476630422e-22*n-.05562186980264034)+r*(.00016141380598724676*r+.0009692239130725186*i+.0007782692450036253*n-.44015232367526463)+i*(5.068882914068769e-7*i+.0017778369011375071*n-.7591454649749609)-n*(.0003435319965105553*n+.7063770186160144);return t.subarray(0,a)},getData:function(t){var r=t.width,i=t.height,n=t.forceRGB,a=t.isSourcePDF;if(this.p>4)throw new e("Unsupported color mode");var o=this.Y(r,i,a);if(1===this.p&&n){for(var s=o.length,h=new Uint8ClampedArray(3*s),l=0,f=0;f<s;f++){var u=o[f];h[l++]=u,h[l++]=u,h[l++]=u}return h}if(3===this.p&&this.f)return this.z(o);if(4===this.p){if(this.f)return n?this.O(o):this.r(o);if(n)return this.U(o)}return o}},u}();function i(t,e){return t[e]<<8|t[e+1]}t.JpegDecoder=r}(),t.encodeImage=function(e,r,i,n){var a={t256:[r],t257:[i],t258:[8,8,8,8],t259:[1],t262:[2],t273:[1e3],t277:[4],t278:[i],t279:[r*i*4],t282:[[72,1]],t283:[[72,1]],t284:[1],t286:[[0,1]],t287:[[0,1]],t296:[1],t305:["Photopea (UTIF.js)"],t338:[1]};if(n)for(var o in n)a[o]=n[o];var s=new Uint8Array(t.encode([a])),h=new Uint8Array(e),l=new Uint8Array(1e3+r*i*4);for(o=0;o<s.length;o++)l[o]=s[o];for(o=0;o<h.length;o++)l[1e3+o]=h[o];return l.buffer},t.encode=function(e){var r=new Uint8Array(2e4),i=4,n=t._binBE;r[0]=r[1]=77,n.writeUshort(r,2,42);var a=8;n.writeUint(r,i,a),i+=4;for(var o=0;o<e.length;o++){var s=t._writeIFD(n,t._types.basic,r,a,e[o]);a=s[1],o<e.length-1&&(0!=(3&a)&&(a+=4-(3&a)),n.writeUint(r,s[0],a))}return r.slice(0,a).buffer},t.decode=function(e,r){null==r&&(r={parseMN:!0,debug:!1});var i=new Uint8Array(e),a=0,o=t._binBE.readASCII(i,a,2);a+=2;var s="II"==o?t._binLE:t._binBE;s.readUshort(i,a),a+=2;var h=s.readUint(i,a);a+=4;for(var l=[];;){var f=s.readUshort(i,h),u=s.readUshort(i,h+4);if(0!=f&&(u<1||13<u)){n("error in TIFF");break}if(t._readIFD(s,i,h,l,0,r),0==(h=s.readUint(i,h+2+12*f)))break}return l},t.decodeImage=function(e,r,i){if(!r.data){var a=new Uint8Array(e),o=t._binBE.readASCII(a,0,2);if(null!=r.t256){r.isLE="II"==o,r.width=r.t256[0],r.height=r.t257[0];var s,h=r.t259?r.t259[0]:1,l=r.t266?r.t266[0]:1;r.t284&&2==r.t284[0]&&n("PlanarConfiguration 2 should not be used!"),7==h&&r.t258&&r.t258.length>3&&(r.t258=r.t258.slice(0,3)),s=r.t258?Math.min(32,r.t258[0])*r.t258.length:r.t277?r.t277[0]:1,1==h&&null!=r.t279&&r.t278&&32803==r.t262[0]&&(s=Math.round(8*r.t279[0]/(r.width*r.t278[0]))),r.t50885&&4==r.t50885[0]&&(s=3*r.t258[0]);var f=8*Math.ceil(r.width*s/8),u=r.t273;(null==u||r.t322)&&(u=r.t324);var c=r.t279;1==h&&1==u.length&&(c=[r.height*(f>>>3)]),(null==c||r.t322)&&(c=r.t325);var d=new Uint8Array(r.height*(f>>>3)),p=0;if(null!=r.t322){var m=r.t322[0],g=r.t323[0],b=Math.floor((r.width+m-1)/m),_=Math.floor((r.height+g-1)/g),y=new Uint8Array(0|Math.ceil(m*g*s/8));console.log("====",b,_);for(var w=0;w<_;w++)for(var v=0;v<b;v++){var x=w*b+v;y.fill(0),t.decode._decompress(r,i,a,u[x],c[x],h,y,0,l),6==h?d=y:t._copyTile(y,0|Math.ceil(m*s/8),g,d,0|Math.ceil(r.width*s/8),r.height,0|Math.ceil(v*m*s/8),w*g)}p=8*d.length}else{var E=r.t278?r.t278[0]:r.height;for(E=Math.min(E,r.height),console.log("====",r.width,E),x=0;x<u.length;x++)t.decode._decompress(r,i,a,u[x],c[x],h,d,0|Math.ceil(p/8),l),p+=f*E;p=Math.min(p,8*d.length)}r.data=new Uint8Array(d.buffer,0,0|Math.ceil(p/8))}}},t.decode._decompress=function(r,i,a,o,s,h,l,f,u){if(1==h)for(var c=0;c<s;c++)l[f+c]=a[o+c];else if(2==h)t.decode._decodeG2(a,o,s,l,f,r.width,u);else if(3==h)t.decode._decodeG3(a,o,s,l,f,r.width,u,!!r.t292&&1==(1&r.t292[0]));else if(4==h)t.decode._decodeG4(a,o,s,l,f,r.width,u);else if(5==h)t.decode._decodeLZW(a,o,s,l,f,8);else if(6==h)t.decode._decodeOldJPEG(r,a,o,s,l,f);else if(7==h||34892==h)t.decode._decodeNewJPEG(r,a,o,s,l,f);else if(8==h||32946==h)for(var d=new Uint8Array(a.buffer,o,s),p=e.inflate(d),m=0;m<p.length;m++)l[f+m]=p[m];else 9==h?t.decode._decodeVC5(a,o,s,l,f):32767==h?t.decode._decodeARW(r,a,o,s,l,f):32773==h?t.decode._decodePackBits(a,o,s,l,f):32809==h?t.decode._decodeThunder(a,o,s,l,f):34713==h?t.decode._decodeNikon(r,i,a,o,s,l,f):34676==h?t.decode._decodeLogLuv32(r,a,o,s,l,f):n("Unknown compression",h);var g=r.t258?Math.min(32,r.t258[0]):1,b=r.t277?r.t277[0]:1,_=g*b>>>3,y=r.t278?r.t278[0]:r.height,w=Math.ceil(g*b*r.width/8);if(16==g&&!r.isLE&&null==r.t33422)for(var v=0;v<y;v++)for(var x=f+v*w,E=1;E<w;E+=2){var k=l[x+E];l[x+E]=l[x+E-1],l[x+E-1]=k}if(r.t317&&2==r.t317[0])for(v=0;v<y;v++){var S=f+v*w;if(16==g)for(c=_;c<w;c+=2){var M=(l[S+c+1]<<8|l[S+c])+(l[S+c-_+1]<<8|l[S+c-_]);l[S+c]=255&M,l[S+c+1]=M>>>8&255}else if(3==b)for(c=3;c<w;c+=3)l[S+c]=l[S+c]+l[S+c-3]&255,l[S+c+1]=l[S+c+1]+l[S+c-2]&255,l[S+c+2]=l[S+c+2]+l[S+c-1]&255;else for(c=_;c<w;c++)l[S+c]=l[S+c]+l[S+c-_]&255}},t.decode._decodeVC5=t.decode._decodeVC5=function(){var e,r,i,n=[1,0,1,0,2,2,1,1,3,7,1,2,5,25,1,3,6,48,1,4,6,54,1,5,7,111,1,8,7,99,1,6,7,105,12,0,7,107,1,7,8,209,20,0,8,212,1,9,8,220,1,10,9,393,1,11,9,394,32,0,9,416,1,12,9,427,1,13,10,887,1,18,10,784,1,14,10,790,1,15,10,835,60,0,10,852,1,16,10,885,1,17,11,1571,1,19,11,1668,1,20,11,1669,100,0,11,1707,1,21,11,1772,1,22,12,3547,1,29,12,3164,1,24,12,3166,1,25,12,3140,1,23,12,3413,1,26,12,3537,1,27,12,3539,1,28,13,7093,1,35,13,6283,1,30,13,6331,1,31,13,6335,180,0,13,6824,1,32,13,7072,1,33,13,7077,320,0,13,7076,1,34,14,12565,1,36,14,12661,1,37,14,12669,1,38,14,13651,1,39,14,14184,1,40,15,28295,1,46,15,28371,1,47,15,25320,1,42,15,25336,1,43,15,25128,1,41,15,27300,1,44,15,28293,1,45,16,50259,1,48,16,50643,1,49,16,50675,1,50,16,56740,1,53,16,56584,1,51,16,56588,1,52,17,113483,1,61,17,113482,1,60,17,101285,1,55,17,101349,1,56,17,109205,1,57,17,109207,1,58,17,100516,1,54,17,113171,1,59,18,202568,1,62,18,202696,1,63,18,218408,1,64,18,218412,1,65,18,226340,1,66,18,226356,1,67,18,226358,1,68,19,402068,1,69,19,405138,1,70,19,405394,1,71,19,436818,1,72,19,436826,1,73,19,452714,1,75,19,452718,1,76,19,452682,1,74,20,804138,1,77,20,810279,1,78,20,810790,1,79,20,873638,1,80,20,873654,1,81,20,905366,1,82,20,905430,1,83,20,905438,1,84,21,1608278,1,85,21,1620557,1,86,21,1621582,1,87,21,1621583,1,88,21,1747310,1,89,21,1810734,1,90,21,1810735,1,91,21,1810863,1,92,21,1810879,1,93,22,3621725,1,99,22,3621757,1,100,22,3241112,1,94,22,3494556,1,95,22,3494557,1,96,22,3494622,1,97,22,3494623,1,98,23,6482227,1,102,23,6433117,1,101,23,6989117,1,103,23,6989119,1,105,23,6989118,1,104,23,7243449,1,106,23,7243512,1,107,24,13978233,1,111,24,12964453,1,109,24,12866232,1,108,24,14486897,1,113,24,13978232,1,110,24,14486896,1,112,24,14487026,1,114,24,14487027,1,115,25,25732598,1,225,25,25732597,1,189,25,25732596,1,188,25,25732595,1,203,25,25732594,1,202,25,25732593,1,197,25,25732592,1,207,25,25732591,1,169,25,25732590,1,223,25,25732589,1,159,25,25732522,1,235,25,25732579,1,152,25,25732575,1,192,25,25732489,1,179,25,25732573,1,201,25,25732472,1,172,25,25732576,1,149,25,25732488,1,178,25,25732566,1,120,25,25732571,1,219,25,25732577,1,150,25,25732487,1,127,25,25732506,1,211,25,25732548,1,125,25,25732588,1,158,25,25732486,1,247,25,25732467,1,238,25,25732508,1,163,25,25732552,1,228,25,25732603,1,183,25,25732513,1,217,25,25732587,1,168,25,25732520,1,122,25,25732484,1,128,25,25732562,1,249,25,25732505,1,187,25,25732504,1,186,25,25732483,1,136,25,25928905,1,181,25,25732560,1,255,25,25732500,1,230,25,25732482,1,135,25,25732555,1,233,25,25732568,1,222,25,25732583,1,145,25,25732481,1,134,25,25732586,1,167,25,25732521,1,248,25,25732518,1,209,25,25732480,1,243,25,25732512,1,216,25,25732509,1,164,25,25732547,1,140,25,25732479,1,157,25,25732544,1,239,25,25732574,1,191,25,25732564,1,251,25,25732478,1,156,25,25732546,1,139,25,25732498,1,242,25,25732557,1,133,25,25732477,1,162,25,25732515,1,213,25,25732584,1,165,25,25732514,1,212,25,25732476,1,227,25,25732494,1,198,25,25732531,1,236,25,25732530,1,234,25,25732529,1,117,25,25732528,1,215,25,25732527,1,124,25,25732526,1,123,25,25732525,1,254,25,25732524,1,253,25,25732523,1,148,25,25732570,1,218,25,25732580,1,146,25,25732581,1,147,25,25732569,1,224,25,25732533,1,143,25,25732540,1,184,25,25732541,1,185,25,25732585,1,166,25,25732556,1,132,25,25732485,1,129,25,25732563,1,250,25,25732578,1,151,25,25732501,1,119,25,25732502,1,193,25,25732536,1,176,25,25732496,1,245,25,25732553,1,229,25,25732516,1,206,25,25732582,1,144,25,25732517,1,208,25,25732558,1,137,25,25732543,1,241,25,25732466,1,237,25,25732507,1,190,25,25732542,1,240,25,25732551,1,131,25,25732554,1,232,25,25732565,1,252,25,25732475,1,171,25,25732493,1,205,25,25732492,1,204,25,25732491,1,118,25,25732490,1,214,25,25928904,1,180,25,25732549,1,126,25,25732602,1,182,25,25732539,1,175,25,25732545,1,141,25,25732559,1,138,25,25732537,1,177,25,25732534,1,153,25,25732503,1,194,25,25732606,1,160,25,25732567,1,121,25,25732538,1,174,25,25732497,1,246,25,25732550,1,130,25,25732572,1,200,25,25732474,1,170,25,25732511,1,221,25,25732601,1,196,25,25732532,1,142,25,25732519,1,210,25,25732495,1,199,25,25732605,1,155,25,25732535,1,154,25,25732499,1,244,25,25732510,1,220,25,25732600,1,195,25,25732607,1,161,25,25732604,1,231,25,25732473,1,173,25,25732599,1,226,26,51465122,1,116,26,51465123,0,1],a=[3,3,3,3,2,2,2,1,1,1];function o(t){var e=t[1],r=t[0][e>>>3]>>>7-(7&e)&1;return t[1]++,r}function s(t,r){if(null==e){e={};for(var i=0;i<n.length;i+=4)e[n[i+1]]=n.slice(i,i+4)}for(var a=o(t),s=e[a];null==s;)a=a<<1|o(t),s=e[a];var h=s[3];0!=h&&(h=0==o(t)?h:-h),r[0]=s[2],r[1]=h}function h(t,e){for(var r=0;r<e;r++)1==(1&t)&&t++,t>>>=1;return t}function l(t,e){return t>>e}function f(t,e,r,i,n,a){e[r]=l(l(11*t[n]-4*t[n+a]+t[n+a+a]+4,3)+t[i],1),e[r+a]=l(l(5*t[n]+4*t[n+a]-t[n+a+a]+4,3)-t[i],1)}function u(t,e,r,i,n,a){var o=t[n-a]-t[n+a],s=t[n],h=t[i];e[r]=l(l(o+4,3)+s+h,1),e[r+a]=l(l(4-o,3)+s-h,1)}function c(t,e,r,i,n,a){e[r]=l(l(5*t[n]+4*t[n-a]-t[n-a-a]+4,3)+t[i],1),e[r+a]=l(l(11*t[n]-4*t[n-a]+t[n-a-a]+4,3)-t[i],1)}function d(t){return i[t=t<0?0:t>4095?4095:t]>>>2}return function(e,n,o,l,p){l=new Uint16Array(l.buffer);var m,g,b,_,y,w,v,x,E=Date.now(),k=t._binBE,S=n+o;for(n+=4;n<S;){var M=k.readShort(e,n),A=k.readUshort(e,n+2);if(n+=4,12==M)L=A;else if(20==M)m=A;else if(21==M)g=A;else if(48==M)b=A;else if(53==M)_=A;else if(35==M);else if(62==M)y=A;else if(101==M);else if(109==M)w=A;else if(84==M);else if(106==M);else if(107==M);else if(108==M);else if(102==M);else if(104==M)tt=A;else if(105==M);else{var I=M<0?-M:M,B=65280&I,T=0;if(24576&I&&(8192&I?(T=65535&A,T+=(255&I)<<16):T=65535&A),24576==(24576&I)){if(null==v){v=[];for(var R=0;R<4;R++)v[R]=new Int16Array((m>>>1)*(g>>>1));for(x=new Int16Array((m>>>1)*(g>>>1)),r=new Int16Array(1024),R=0;R<1024;R++){var P=R-512,O=Math.abs(P),L=Math.floor(768*O*O*O/16581375)+O;r[R]=Math.sign(P)*L}for(i=new Uint16Array(4096),R=0;R<4096;R++){var C=R,U=65535*(Math.pow(113,C/4095)-1)/112;i[R]=Math.min(U,65535)}}var z=v[y],D=h(m,1+a[b]),N=h(g,1+a[b]);if(0==b)for(var F=0;F<N;F++)for(var j=0;j<D;j++){var G=n+2*(F*D+j);z[F*(m>>>1)+j]=e[G]<<8|e[G+1]}else{var H=[e,8*n],W=[],q=0,Z=D*N,Y=[0,0],V=0;for(A=0;q<Z;)for(s(H,Y),V=Y[0],A=Y[1];V>0;)W[q++]=A,V--;var X=(b-1)%3,J=1!=X?D:0,Q=0!=X?N:0;for(F=0;F<N;F++){var K=(F+Q)*(m>>>1)+J,$=F*D;for(j=0;j<D;j++)z[K+j]=r[W[$+j]+512]*_}if(2==X){var tt=m>>>1,et=2*D,rt=2*N;for(F=0;F<N;F++)for(j=0;j<et;j++){R=2*F*tt+j;var it=N*tt+(at=F*tt+j);0==F?f(z,x,R,it,at,tt):F==N-1?c(z,x,R,it,at,tt):u(z,x,R,it,at,tt)}var nt=z;for(z=x,x=nt,F=0;F<rt;F++)for(j=0;j<D;j++){var at;R=F*tt+2*j,it=D+(at=F*tt+j),0==j?f(z,x,R,it,at,1):j==D-1?c(z,x,R,it,at,1):u(z,x,R,it,at,1)}nt=z,z=x,x=nt;for(var ot=[],st=2-~~((b-1)/3),ht=0;ht<3;ht++)ot[ht]=w>>14-2*ht&3;var lt=ot[st];if(0!=lt)for(F=0;F<rt;F++)for(j=0;j<et;j++)z[R=F*tt+j]=z[R]<<lt}}if(9==b&&3==y){var ft=v[0],ut=v[1],ct=v[2],dt=v[3];for(F=0;F<g;F+=2)for(j=0;j<m;j+=2){var pt=F*m+j,mt=ft[G=(F>>>1)*(m>>>1)+(j>>>1)],gt=ut[G]-2048,bt=ct[G]-2048,_t=dt[G]-2048,yt=(gt<<1)+mt,wt=(bt<<1)+mt,vt=mt+_t,xt=mt-_t;l[pt]=d(yt),l[pt+1]=d(vt),l[pt+m]=d(xt),l[pt+m+1]=d(wt)}}n+=4*T}else if(16388==I)n+=4*T;else if(8192!=B&&8448!=B&&9216!=B)throw I.toString(16)}}console.log(Date.now()-E)}}(),t.decode._decodeLogLuv32=function(t,e,r,i,n,a){for(var o=t.width,s=4*o,h=0,l=new Uint8Array(s);h<i;){for(var f=0;f<s;){var u=e[r+h];if(h++,u<128){for(var c=0;c<u;c++)l[f+c]=e[r+h+c];f+=u,h+=u}else{for(u-=126,c=0;c<u;c++)l[f+c]=e[r+h];f+=u,h++}}for(var d=0;d<o;d++)n[a+0]=l[d],n[a+1]=l[d+o],n[a+2]=l[d+2*o],n[a+4]=l[d+3*o],a+=6}},t.decode._ljpeg_diff=function(e,r,i){var n,a,o=t.decode._getbithuff;return n=o(e,r,i[0],i),0==((a=o(e,r,n,0))&1<<n-1)&&(a-=(1<<n)-1),a},t.decode._decodeARW=function(e,r,i,n,a,o){var s=e.t256[0],h=e.t257[0],l=e.t258[0],f=e.isLE?t._binLE:t._binBE;if(s*h==n||s*h*1.5==n)if(s*h*1.5!=n){var u,c,d,p,m,g,b,_,y=new Uint16Array(16),w=new Uint8Array(s+1);for(I=0;I<h;I++){for(var v=0;v<s;v++)w[v]=r[i++];for(_=0,A=0;A<s-30;_+=16){for(c=2047&(u=f.readUint(w,_)),d=2047&u>>>11,p=15&u>>>22,m=15&u>>>26,g=0;g<4&&128<<g<=c-d;g++);for(b=30,x=0;x<16;x++)x==p?y[x]=c:x==m?y[x]=d:(y[x]=((f.readUshort(w,_+(b>>3))>>>(7&b)&127)<<g)+d,y[x]>2047&&(y[x]=2047),b+=7);for(x=0;x<16;x++,A+=2)U=y[x]<<1,t.decode._putsF(a,(I*s+A)*l,U<<16-l);A-=1&A?1:31}}}else for(var x=0;x<n;x+=3){var E=r[i+x+0],k=r[i+x+1],S=r[i+x+2];a[o+x]=k<<4|E>>>4,a[o+x+1]=E<<4|S>>>4,a[o+x+2]=S<<4|k>>>4}else{h+=8;var M,A,I,B=[i,0,0,0],T=new Uint16Array(32770),R=[3857,3856,3599,3342,3085,2828,2571,2314,2057,1800,1543,1286,1029,772,771,768,514,513],P=0,O=t.decode._ljpeg_diff;for(T[0]=15,M=x=0;x<18;x++)for(var L=32768>>>(R[x]>>>8),C=0;C<L;C++)T[++M]=R[x];for(A=s;A--;)for(I=0;I<h+1;I+=2)if(I==h&&(I=1),P+=O(r,B,T),I<h){var U=4095&P;t.decode._putsF(a,(I*s+A)*l,U<<16-l)}}},t.decode._decodeNikon=function(e,r,i,n,a,o,s){var h=[[0,0,1,5,1,1,1,1,1,1,2,0,0,0,0,0,0,5,4,3,6,2,7,1,0,8,9,11,10,12],[0,0,1,5,1,1,1,1,1,1,2,0,0,0,0,0,0,57,90,56,39,22,5,4,3,2,1,0,11,12,12],[0,0,1,4,2,3,1,2,0,0,0,0,0,0,0,0,0,5,4,6,3,7,2,8,1,9,0,10,11,12],[0,0,1,4,3,1,1,1,1,1,2,0,0,0,0,0,0,5,6,4,7,8,3,9,2,1,0,10,11,12,13,14],[0,0,1,5,1,1,1,1,1,1,1,2,0,0,0,0,0,8,92,75,58,41,7,6,5,4,3,2,1,0,13,14],[0,0,1,4,2,2,3,1,2,0,0,0,0,0,0,0,0,7,6,8,5,9,4,10,3,11,12,2,0,1,13,14]],l=e.t256[0],f=e.t257[0],u=e.t258[0],c=0,d=0,p=t.decode._make_decoder,m=t.decode._getbithuff,g=r[0].exifIFD.makerNote,b=g.t150?g.t150:g.t140,_=0,y=b[_++],w=b[_++];73!=y&&88!=w||(_+=2110),70==y&&(c=2),14==u&&(c+=3);for(var v=[[0,0],[0,0]],x=e.isLE?t._binLE:t._binBE,E=0;E<2;E++)for(var k=0;k<2;k++)v[E][k]=x.readShort(b,_),_+=2;var S,M,A,I,B,T=1<<u&32767,R=0,P=x.readShort(b,_);_+=2,P>1&&(R=Math.floor(T/(P-1))),68==y&&32==w&&R>0&&(d=x.readShort(b,562));var O=[0,0],L=p(h[c]),C=[n,0,0,0];for(S=0;S<f;S++)for(d&&S==d&&(L=p(h[c+1])),M=0;M<l;M++){E=m(i,C,L[0],L),0==((B=1+(m(i,C,(A=15&E)-(I=E>>>4),0)<<1)<<I>>>1)&1<<A-1)&&(B-=(1<<A)-(0==I?1:0)),M<2?O[M]=v[1&S][M]+=B:O[1&M]+=B;var U=Math.min(Math.max(O[1&M],0),(1<<u)-1),z=(S*l+M)*u;t.decode._putsF(o,z,U<<16-u)}},t.decode._putsF=function(t,e,r){r<<=8-(7&e);var i=e>>>3;t[i]|=r>>>16,t[i+1]|=r>>>8,t[i+2]|=r},t.decode._getbithuff=function(e,r,i,n){t.decode._get_byte;var a,o=r[0],s=r[1],h=r[2],l=r[3];if(0==i||h<0)return 0;for(;!l&&h<i&&-1!=(a=e[o++])&&!(l=0);)s=(s<<8)+a,h+=8;if(a=s<<32-h>>>32-i,n?(h-=n[a+1]>>>8,a=255&n[a+1]):h-=i,h<0)throw"e";return r[0]=o,r[1]=s,r[2]=h,r[3]=l,a},t.decode._make_decoder=function(t){var e,r,i,n,a,o=[];for(e=16;0!=e&&!t[e];e--);var s=17;for(o[0]=e,i=r=1;r<=e;r++)for(n=0;n<t[r];n++,++s)for(a=0;a<1<<e-r;a++)i<=1<<e&&(o[i++]=r<<8|t[s]);return o},t.decode._decodeNewJPEG=function(e,r,i,n,a,o){n=Math.min(n,r.length-i);var s=e.t347,h=s?s.length:0,l=new Uint8Array(h+n);if(s){for(var f=0,u=0;u<h-1&&(255!=s[u]||217!=s[u+1]);u++)l[f++]=s[u];var c=r[i],d=r[i+1];for(255==c&&216==d||(l[f++]=c,l[f++]=d),u=2;u<n;u++)l[f++]=r[i+u]}else for(u=0;u<n;u++)l[u]=r[i+u];if(32803==e.t262[0]||7==e.t259[0]&&34892==e.t262[0]){var p=e.t258[0],m=t.LosslessJpegDecode(l),g=m.length;if(16==p)if(e.isLE)for(u=0;u<g;u++)a[o+(u<<1)]=255&m[u],a[o+(u<<1)+1]=m[u]>>>8;else for(u=0;u<g;u++)a[o+(u<<1)]=m[u]>>>8,a[o+(u<<1)+1]=255&m[u];else if(14==p||12==p){var b=16-p;for(u=0;u<g;u++)t.decode._putsF(a,u*p,m[u]<<b)}else{if(8!=p)throw new Error("unsupported bit depth "+p);for(u=0;u<g;u++)a[o+u]=m[u]}}else{var _=new t.JpegDecoder;_.parse(l);var y=_.getData({width:_.width,height:_.height,forceRGB:!0,isSourcePDF:!1});for(u=0;u<y.length;u++)a[o+u]=y[u]}6==e.t262[0]&&(e.t262[0]=2)},t.decode._decodeOldJPEGInit=function(t,e,r,i){var a,o,s,h,l,f=216,u=0,c=0,d=!1,p=t.t513,m=p?p[0]:0,g=t.t514,b=g?g[0]:0,_=t.t324||t.t273||p,y=t.t530,w=0,v=0,x=t.t277?t.t277[0]:1,E=t.t515;if(_&&(c=_[0],d=_.length>1),!d){if(255==e[r]&&e[r+1]==f)return{jpegOffset:r};if(null!=p&&(255==e[r+m]&&e[r+m+1]==f?u=r+m:n("JPEGInterchangeFormat does not point to SOI"),null==g?n("JPEGInterchangeFormatLength field is missing"):(m>=c||m+b<=c)&&n("JPEGInterchangeFormatLength field value is invalid"),null!=u))return{jpegOffset:u}}if(null!=y&&(w=y[0],v=y[1]),null!=p&&null!=g)if(b>=2&&m+b<=c){for(a=255==e[r+m+b-2]&&e[r+m+b-1]==f?new Uint8Array(b-2):new Uint8Array(b),s=0;s<a.length;s++)a[s]=e[r+m+s];n("Incorrect JPEG interchange format: using JPEGInterchangeFormat offset to derive tables")}else n("JPEGInterchangeFormat+JPEGInterchangeFormatLength > offset to first strip or tile");if(null==a){var k=0,S=[];S[k++]=255,S[k++]=f;var M=t.t519;if(null==M)throw new Error("JPEGQTables tag is missing");for(s=0;s<M.length;s++)for(S[k++]=255,S[k++]=219,S[k++]=0,S[k++]=67,S[k++]=s,h=0;h<64;h++)S[k++]=e[r+M[s]+h];for(l=0;l<2;l++){var A=t[0==l?"t520":"t521"];if(null==A)throw new Error((0==l?"JPEGDCTables":"JPEGACTables")+" tag is missing");for(s=0;s<A.length;s++){S[k++]=255,S[k++]=196;var I=19;for(h=0;h<16;h++)I+=e[r+A[s]+h];for(S[k++]=I>>>8,S[k++]=255&I,S[k++]=s|l<<4,h=0;h<16;h++)S[k++]=e[r+A[s]+h];for(h=0;h<I;h++)S[k++]=e[r+A[s]+16+h]}}if(S[k++]=255,S[k++]=192,S[k++]=0,S[k++]=8+3*x,S[k++]=8,S[k++]=t.height>>>8&255,S[k++]=255&t.height,S[k++]=t.width>>>8&255,S[k++]=255&t.width,S[k++]=x,1==x)S[k++]=1,S[k++]=17,S[k++]=0;else for(s=0;s<3;s++)S[k++]=s+1,S[k++]=0!=s?17:(15&w)<<4|15&v,S[k++]=s;null!=E&&0!=E[0]&&(S[k++]=255,S[k++]=221,S[k++]=0,S[k++]=4,S[k++]=E[0]>>>8&255,S[k++]=255&E[0]),a=new Uint8Array(S)}var B=-1;for(s=0;s<a.length-1;){if(255==a[s]&&192==a[s+1]){B=s;break}s++}if(-1==B){var T=new Uint8Array(a.length+10+3*x);T.set(a);var R=a.length;if(B=a.length,(a=T)[R++]=255,a[R++]=192,a[R++]=0,a[R++]=8+3*x,a[R++]=8,a[R++]=t.height>>>8&255,a[R++]=255&t.height,a[R++]=t.width>>>8&255,a[R++]=255&t.width,a[R++]=x,1==x)a[R++]=1,a[R++]=17,a[R++]=0;else for(s=0;s<3;s++)a[R++]=s+1,a[R++]=0!=s?17:(15&w)<<4|15&v,a[R++]=s}if(255==e[c]&&218==e[c+1]){var P=e[c+2]<<8|e[c+3];for((o=new Uint8Array(P+2))[0]=e[c],o[1]=e[c+1],o[2]=e[c+2],o[3]=e[c+3],s=0;s<P-2;s++)o[s+4]=e[c+s+4]}else{var O=0;if((o=new Uint8Array(8+2*x))[O++]=255,o[O++]=218,o[O++]=0,o[O++]=6+2*x,o[O++]=x,1==x)o[O++]=1,o[O++]=0;else for(s=0;s<3;s++)o[O++]=s+1,o[O++]=s<<4|s;o[O++]=0,o[O++]=63,o[O++]=0}return{jpegOffset:r,tables:a,sosMarker:o,sofPosition:B}},t.decode._decodeOldJPEG=function(e,r,i,n,a,o){var s,h,l,f,u=t.decode._decodeOldJPEGInit(e,r,i,n);if(null!=u.jpegOffset)for(s=i+n-u.jpegOffset,l=new Uint8Array(s),p=0;p<s;p++)l[p]=r[u.jpegOffset+p];else{for(h=u.tables.length,(l=new Uint8Array(h+u.sosMarker.length+n+2)).set(u.tables),f=h,l[u.sofPosition+5]=e.height>>>8&255,l[u.sofPosition+6]=255&e.height,l[u.sofPosition+7]=e.width>>>8&255,l[u.sofPosition+8]=255&e.width,255==r[i]&&r[i+1]==SOS||(l.set(u.sosMarker,f),f+=sosMarker.length),p=0;p<n;p++)l[f++]=r[i+p];l[f++]=255,l[f++]=EOI}var c=new t.JpegDecoder;c.parse(l);for(var d=c.getData({width:c.width,height:c.height,forceRGB:!0,isSourcePDF:!1}),p=0;p<d.length;p++)a[o+p]=d[p];e.t262&&6==e.t262[0]&&(e.t262[0]=2)},t.decode._decodePackBits=function(t,e,r,i,n){for(var a=new Int8Array(t.buffer),o=new Int8Array(i.buffer),s=e+r;e<s;){var h=a[e];if(e++,h>=0&&h<128)for(var l=0;l<h+1;l++)o[n]=a[e],n++,e++;if(h>=-127&&h<0){for(l=0;l<1-h;l++)o[n]=a[e],n++;e++}}return n},t.decode._decodeThunder=function(t,e,r,i,n){for(var a=[0,1,0,-1],o=[0,1,2,3,0,-3,-2,-1],s=e+r,h=2*n,l=0;e<s;){var f=t[e],u=f>>>6,c=63&f;if(e++,3==u&&(l=15&c,i[h>>>1]|=l<<4*(1-h&1),h++),0==u)for(var d=0;d<c;d++)i[h>>>1]|=l<<4*(1-h&1),h++;if(2==u)for(d=0;d<2;d++)4!=(p=c>>>3*(1-d)&7)&&(l+=o[p],i[h>>>1]|=l<<4*(1-h&1),h++);if(1==u)for(d=0;d<3;d++){var p;2!=(p=c>>>2*(2-d)&3)&&(l+=a[p],i[h>>>1]|=l<<4*(1-h&1),h++)}}},t.decode._dmap={1:0,"011":1,"000011":2,"0000011":3,"010":-1,"000010":-2,"0000010":-3},t.decode._lens=function(){var t=function(t,e,r,i){for(var n=0;n<e.length;n++)t[e[n]]=r+n*i},e="00110101,000111,0111,1000,1011,1100,1110,1111,10011,10100,00111,01000,001000,000011,110100,110101,101010,101011,0100111,0001100,0001000,0010111,0000011,0000100,0101000,0101011,0010011,0100100,0011000,00000010,00000011,00011010,00011011,00010010,00010011,00010100,00010101,00010110,00010111,00101000,00101001,00101010,00101011,00101100,00101101,00000100,00000101,00001010,00001011,01010010,01010011,01010100,01010101,00100100,00100101,01011000,01011001,01011010,01011011,01001010,01001011,00110010,00110011,00110100",r="0000110111,010,11,10,011,0011,0010,00011,000101,000100,0000100,0000101,0000111,00000100,00000111,000011000,0000010111,0000011000,0000001000,00001100111,00001101000,00001101100,00000110111,00000101000,00000010111,00000011000,000011001010,000011001011,000011001100,000011001101,000001101000,000001101001,000001101010,000001101011,000011010010,000011010011,000011010100,000011010101,000011010110,000011010111,000001101100,000001101101,000011011010,000011011011,000001010100,000001010101,000001010110,000001010111,000001100100,000001100101,000001010010,000001010011,000000100100,000000110111,000000111000,000000100111,000000101000,000001011000,000001011001,000000101011,000000101100,000001011010,000001100110,000001100111",i="11011,10010,010111,0110111,00110110,00110111,01100100,01100101,01101000,01100111,011001100,011001101,011010010,011010011,011010100,011010101,011010110,011010111,011011000,011011001,011011010,011011011,010011000,010011001,010011010,011000,010011011",n="0000001111,000011001000,000011001001,000001011011,000000110011,000000110100,000000110101,0000001101100,0000001101101,0000001001010,0000001001011,0000001001100,0000001001101,0000001110010,0000001110011,0000001110100,0000001110101,0000001110110,0000001110111,0000001010010,0000001010011,0000001010100,0000001010101,0000001011010,0000001011011,0000001100100,0000001100101",a="00000001000,00000001100,00000001101,000000010010,000000010011,000000010100,000000010101,000000010110,000000010111,000000011100,000000011101,000000011110,000000011111";e=e.split(","),r=r.split(","),i=i.split(","),n=n.split(","),a=a.split(",");var o={},s={};return t(o,e,0,1),t(o,i,64,64),t(o,a,1792,64),t(s,r,0,1),t(s,n,64,64),t(s,a,1792,64),[o,s]}(),t.decode._decodeG4=function(e,r,i,n,a,o,s){for(var h=t.decode,l=r<<3,f=0,u="",c=[],d=[],p=0;p<o;p++)d.push(0);d=h._makeDiff(d);for(var m=0,g=0,b=0,_=0,y=0,w=0,v="",x=0,E=8*Math.ceil(o/8);l>>>3<r+i;){b=h._findDiff(d,m+(0==m?0:1),1-y),_=h._findDiff(d,b,y);var k=0;if(1==s&&(k=e[l>>>3]>>>7-(7&l)&1),2==s&&(k=e[l>>>3]>>>(7&l)&1),l++,u+=k,"H"==v){if(null!=h._lens[y][u]){var S=h._lens[y][u];u="",f+=S,S<64&&(h._addNtimes(c,f,y),m+=f,y=1-y,f=0,0==--x&&(v=""))}}else"0001"==u&&(u="",h._addNtimes(c,_-m,y),m=_),"001"==u&&(u="",v="H",x=2),null!=h._dmap[u]&&(g=b+h._dmap[u],h._addNtimes(c,g-m,y),m=g,u="",y=1-y);c.length==o&&""==v&&(h._writeBits(c,n,8*a+w*E),y=0,w++,m=0,d=h._makeDiff(c),c=[])}},t.decode._findDiff=function(t,e,r){for(var i=0;i<t.length;i+=2)if(t[i]>=e&&t[i+1]==r)return t[i]},t.decode._makeDiff=function(t){var e=[];1==t[0]&&e.push(0,1);for(var r=1;r<t.length;r++)t[r-1]!=t[r]&&e.push(r,t[r]);return e.push(t.length,0,t.length,1),e},t.decode._decodeG2=function(e,r,i,n,a,o,s){for(var h=t.decode,l=r<<3,f=0,u="",c=[],d=0,p=0,m=8*Math.ceil(o/8);l>>>3<r+i;){var g=0;1==s&&(g=e[l>>>3]>>>7-(7&l)&1),2==s&&(g=e[l>>>3]>>>(7&l)&1),l++,u+=g,null!=(f=h._lens[d][u])&&(h._addNtimes(c,f,d),u="",f<64&&(d=1-d),c.length==o&&(h._writeBits(c,n,8*a+p*m),c=[],p++,d=0,0!=(7&l)&&(l+=8-(7&l)),f>=64&&(l+=8)))}},t.decode._decodeG3=function(e,r,i,n,a,o,s,h){for(var l=t.decode,f=r<<3,u=0,c="",d=[],p=[],m=0;m<o;m++)d.push(0);for(var g=0,b=0,_=0,y=0,w=0,v=-1,x="",E=0,k=!0,S=8*Math.ceil(o/8);f>>>3<r+i;){_=l._findDiff(p,g+(0==g?0:1),1-w),y=l._findDiff(p,_,w);var M=0;if(1==s&&(M=e[f>>>3]>>>7-(7&f)&1),2==s&&(M=e[f>>>3]>>>(7&f)&1),f++,c+=M,k){if(null!=l._lens[w][c]){var A=l._lens[w][c];c="",u+=A,A<64&&(l._addNtimes(d,u,w),w=1-w,u=0)}}else"H"==x?null!=l._lens[w][c]&&(A=l._lens[w][c],c="",u+=A,A<64&&(l._addNtimes(d,u,w),g+=u,w=1-w,u=0,0==--E&&(x=""))):("0001"==c&&(c="",l._addNtimes(d,y-g,w),g=y),"001"==c&&(c="",x="H",E=2),null!=l._dmap[c]&&(b=_+l._dmap[c],l._addNtimes(d,b-g,w),g=b,c="",w=1-w));c.endsWith("000000000001")&&(v>=0&&l._writeBits(d,n,8*a+v*S),h&&(1==s&&(k=1==(e[f>>>3]>>>7-(7&f)&1)),2==s&&(k=1==(e[f>>>3]>>>(7&f)&1)),f++),c="",w=0,v++,g=0,p=l._makeDiff(d),d=[])}d.length==o&&l._writeBits(d,n,8*a+v*S)},t.decode._addNtimes=function(t,e,r){for(var i=0;i<e;i++)t.push(r)},t.decode._writeBits=function(t,e,r){for(var i=0;i<t.length;i++)e[r+i>>>3]|=t[i]<<7-(r+i&7)},t.decode._decodeLZW=t.decode._decodeLZW=(s=0,h=0,l=0,f=0,u=function(){var t=r>>>3,e=(i[t]<<16|i[t+1]<<8|i[t+2])>>>24-(7&r)-h&(1<<h)-1;return r+=h,e},c=new Uint32Array(16384),d=0,p=function(t){h=t+1,s=f+1},m=function(t){for(var e=t<<2,r=c[e+2],i=o+r-1;65535!=e;)a[i--]=c[e],e=c[e+1];o+=r},g=function(t,e){var r=s<<2,i=t<<2;c[r]=c[3+(e<<2)],c[r+1]=i,c[r+2]=c[i+2]+1,c[r+3]=c[i+3],1+ ++s==1<<h&&12!=h&&h++},function(t,e,n,h,b,_){r=e<<3,i=t,a=h,o=b;var y=e+n<<3,w=0,v=0;for(function(t){if(t!=d){d=t,f=1+(l=1<<t);for(var e=0;e<f+1;e++)c[4*e]=c[4*e+3]=e,c[4*e+1]=65535,c[4*e+2]=1}}(_),p(_);r<y&&(w=u())!=f;){if(w==l){if(p(_),(w=u())==f)break;m(w)}else w<s?(m(w),g(v,w)):(g(v,v),m(s-1));v=w}return o}),t.tags={},t._types=((b=new Array(250)).fill(0),{basic:{main:b=b.concat([0,0,0,0,4,3,3,3,3,3,0,0,3,0,0,0,3,0,0,2,2,2,2,4,3,0,0,3,4,4,3,3,5,5,3,2,5,5,0,0,0,0,4,4,0,0,3,3,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,2,2,3,5,5,3,0,3,3,4,4,4,3,4,0,0,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),rest:{33432:2,33434:5,33437:5,34665:4,34850:3,34853:4,34855:3,34864:3,34866:4,36864:7,36867:2,36868:2,37121:7,37377:10,37378:5,37380:10,37381:5,37383:3,37384:3,37385:3,37386:5,37510:7,37520:2,37521:2,37522:2,40960:7,40961:3,40962:4,40963:4,40965:4,41486:5,41487:5,41488:3,41985:3,41986:3,41987:3,41988:5,41989:3,41990:3,41993:3,41994:3,41995:7,41996:3,42032:2,42033:2,42034:5,42036:2,42037:2,59932:7}},gps:{main:[1,2,5,2,5,1,5,5,0,9],rest:{18:2,29:2}}}),t._readIFD=function(e,r,i,a,o,s){var h=e.readUshort(r,i);i+=2;var l={};s.debug&&n("   ".repeat(o),a.length-1,">>>----------------");for(var f=0;f<h;f++){var u=e.readUshort(r,i);i+=2;var c=e.readUshort(r,i);i+=2;var d=e.readUint(r,i);i+=4;var p=e.readUint(r,i);i+=4;var m=[];if(1!=c&&7!=c||(m=new Uint8Array(r.buffer,d<5?i-4:p,d)),2==c){var g=d<5?i-4:p,b=r[g],_=Math.max(0,Math.min(d-1,r.length-g));b<128||0==_?m.push(e.readASCII(r,g,_)):m=new Uint8Array(r.buffer,g,_)}if(3==c)for(var y=0;y<d;y++)m.push(e.readUshort(r,(d<3?i-4:p)+2*y));if(4==c||13==c)for(y=0;y<d;y++)m.push(e.readUint(r,(d<2?i-4:p)+4*y));if(5==c||10==c){var w=5==c?e.readUint:e.readInt;for(y=0;y<d;y++)m.push([w(r,p+8*y),w(r,p+8*y+4)])}if(8==c)for(y=0;y<d;y++)m.push(e.readShort(r,(d<3?i-4:p)+2*y));if(9==c)for(y=0;y<d;y++)m.push(e.readInt(r,(d<2?i-4:p)+4*y));if(11==c)for(y=0;y<d;y++)m.push(e.readFloat(r,p+4*y));if(12==c)for(y=0;y<d;y++)m.push(e.readDouble(r,p+8*y));if(0==d||0!=m.length){if(s.debug&&n("   ".repeat(o),u,c,t.tags[u],m),l["t"+u]=m,330==u&&l.t272&&"DSLR-A100"==l.t272[0]);else if(330==u||34665==u||34853==u||50740==u&&e.readUshort(r,e.readUint(m,0))<300||61440==u){var v=50740==u?[e.readUint(m,0)]:m,x=[];for(y=0;y<v.length;y++)t._readIFD(e,r,v[y],x,o+1,s);330==u&&(l.subIFD=x),34665==u&&(l.exifIFD=x[0]),34853==u&&(l.gpsiIFD=x[0]),50740==u&&(l.dngPrvt=x[0]),61440==u&&(l.fujiIFD=x[0])}if(37500==u&&s.parseMN){var E=m;if("Nikon"==e.readASCII(E,0,5))l.makerNote=t.decode(E.slice(10).buffer)[0];else if(e.readUshort(r,p)<300&&e.readUshort(r,p+4)<=12){var k=[];t._readIFD(e,r,p,k,o+1,s),l.makerNote=k[0]}}}else if(n(u,"unknown TIFF tag type: ",c,"num:",d),0==f)return}return a.push(l),s.debug&&n("   ".repeat(o),"<<<---------------"),i},t._writeIFD=function(e,r,i,n,a){var o=Object.keys(a),s=o.length;a.exifIFD&&s--,a.gpsiIFD&&s--,e.writeUshort(i,n,s);for(var h=(n+=2)+12*s+4,l=0;l<o.length;l++){var f=o[l];if("t34665"!=f&&"t34853"!=f){"exifIFD"==f&&(f="t34665"),"gpsiIFD"==f&&(f="t34853");var u=parseInt(f.slice(1)),c=r.main[u];if(null==c&&(c=r.rest[u]),null==c||0==c)throw new Error("unknown type of tag: "+u);var d=a[f];34665==u&&(d=[h],h=t._writeIFD(e,r,i,h,a.exifIFD)[1]),34853==u&&(d=[h],h=t._writeIFD(e,t._types.gps,i,h,a.gpsiIFD)[1]),2==c&&(d=d[0]+"\0");var p=d.length;e.writeUshort(i,n,u),n+=2,e.writeUshort(i,n,c),n+=2,e.writeUint(i,n,p);var m=[-1,1,1,2,4,8,0,1,0,4,8,0,8][c]*p,g=n+=4;if(m>4&&(e.writeUint(i,n,h),g=h),1==c||7==c)for(var b=0;b<p;b++)i[g+b]=d[b];else if(2==c)e.writeASCII(i,g,d);else if(3==c)for(b=0;b<p;b++)e.writeUshort(i,g+2*b,d[b]);else if(4==c)for(b=0;b<p;b++)e.writeUint(i,g+4*b,d[b]);else if(5==c||10==c){var _=5==c?e.writeUint:e.writeInt;for(b=0;b<p;b++){var y=d[b],w=y[0],v=y[1];if(null==w)throw"e";_(i,g+8*b,w),_(i,g+8*b+4,v)}}else if(9==c)for(b=0;b<p;b++)e.writeInt(i,g+4*b,d[b]);else{if(12!=c)throw c;for(b=0;b<p;b++)e.writeDouble(i,g+8*b,d[b])}m>4&&(h+=m+=1&m),n+=4}}return[n,h]},t.toRGBA8=function(t,e){var r=t.width,i=t.height,a=r*i,o=4*a,s=t.data,h=new Uint8Array(4*a),l=t.t262?t.t262[0]:2,f=t.t258?Math.min(32,t.t258[0]):1;if(null==t.t262&&1==f&&(l=0),0==l)for(var u=Math.ceil(f*r/8),c=0;c<i;c++){var d=c*u,p=c*r;if(1==f)for(var m=0;m<r;m++){var g=p+m<<2,b=s[d+(m>>3)]>>7-(7&m)&1;h[g]=h[g+1]=h[g+2]=255*(1-b),h[g+3]=255}if(4==f)for(m=0;m<r;m++)g=p+m<<2,b=s[d+(m>>1)]>>4-4*(1&m)&15,h[g]=h[g+1]=h[g+2]=17*(15-b),h[g+3]=255;if(8==f)for(m=0;m<r;m++)g=p+m<<2,b=s[d+m],h[g]=h[g+1]=h[g+2]=255-b,h[g+3]=255}else if(1==l){var _=t.t258?t.t258.length:1;for(u=Math.ceil(_*f*r/8),null==e&&(e=1/256),c=0;c<i;c++){if(d=c*u,p=c*r,1==f)for(m=0;m<r;m++)g=p+m<<2,b=s[d+(m>>3)]>>7-(7&m)&1,h[g]=h[g+1]=h[g+2]=255*b,h[g+3]=255;if(2==f)for(m=0;m<r;m++)g=p+m<<2,b=s[d+(m>>2)]>>6-2*(3&m)&3,h[g]=h[g+1]=h[g+2]=85*b,h[g+3]=255;if(8==f)for(m=0;m<r;m++)g=p+m<<2,b=s[d+m*_],h[g]=h[g+1]=h[g+2]=b,h[g+3]=255;if(16==f)for(m=0;m<r;m++){g=p+m<<2;var y=d+2*m;b=s[y+1]<<8|s[y],h[g]=h[g+1]=h[g+2]=Math.min(255,~~(b*e)),h[g+3]=255}}}else if(2==l)if(_=t.t258?t.t258.length:3,8==f){if(4==_)for(m=0;m<o;m++)h[m]=s[m];if(3==_)for(m=0;m<a;m++){var w=3*m;h[g=m<<2]=s[w],h[g+1]=s[w+1],h[g+2]=s[w+2],h[g+3]=255}}else if(16==f){if(4==_)for(m=0;m<a;m++)w=8*m+1,h[g=m<<2]=s[w],h[g+1]=s[w+2],h[g+2]=s[w+4],h[g+3]=s[w+6];if(3==_)for(m=0;m<a;m++)w=6*m+1,h[g=m<<2]=s[w],h[g+1]=s[w+2],h[g+2]=s[w+4],h[g+3]=255}else{if(32!=f)throw f;if(!h.isLE)for(m=0;m<s.length;m+=4){var v=s[m];s[m]=s[m+3],s[m+3]=v,v=s[m+1],s[m+1]=s[m+2],s[m+2]=v}var x=new Float32Array(s.buffer);if(3!=_)throw _;for(m=0;m<a;m++)w=3*m,h[g=m<<2]=~~(.5+255*x[w]),h[g+1]=~~(.5+255*x[w+1]),h[g+2]=~~(.5+255*x[w+2]),h[g+3]=255}else if(3==l){var E=t.t320,k=(_=t.t258?t.t258.length:1,u=Math.ceil(_*f*r/8),1<<f);for(c=0;c<i;c++)for(var S=0;S<r;S++){g=(m=c*r+S)<<2;var M=0,A=c*u;if(1==f)M=s[A+(S>>>3)]>>>7-(7&S)&1;else if(2==f)M=s[A+(S>>>2)]>>>6-2*(3&S)&3;else if(4==f)M=s[A+(S>>>1)]>>>4-4*(1&S)&15;else{if(8!=f)throw f;M=s[A+S*_]}h[g]=E[M]>>8,h[g+1]=E[k+M]>>8,h[g+2]=E[k+k+M]>>8,h[g+3]=255}}else if(5==l){var I=(_=t.t258?t.t258.length:4)>4?1:0;for(m=0;m<a;m++){g=m<<2;var B=m*_;if(UDOC){var T=s[B],R=s[B+1],P=s[B+2],O=s[B+3],L=UDOC.C.cmykToRgb([T*(1/255),R*(1/255),P*(1/255),O*(1/255)]);h[g]=~~(.5+255*L[0]),h[g+1]=~~(.5+255*L[1]),h[g+2]=~~(.5+255*L[2])}else T=255-s[B],R=255-s[B+1],P=255-s[B+2],O=(255-s[B+3])*(1/255),h[g]=~~(T*O+.5),h[g+1]=~~(R*O+.5),h[g+2]=~~(P*O+.5);h[g+3]=255*(1-I)+s[B+4]*I}}else if(6==l&&t.t278){var C=t.t278[0];for(c=0;c<i;c+=C){m=c*r;for(var U=C*r,z=0;z<U;z++){g=4*(m+z),P=s[(B=3*m+4*(z>>>1))+(1&z)];var D=s[B+2]-128,N=s[B+3]-128,F=P+((N>>2)+(N>>3)+(N>>5)),j=P-((D>>2)+(D>>4)+(D>>5))-((N>>1)+(N>>3)+(N>>4)+(N>>5)),G=P+(D+(D>>1)+(D>>2)+(D>>6));h[g]=Math.max(0,Math.min(255,F)),h[g+1]=Math.max(0,Math.min(255,j)),h[g+2]=Math.max(0,Math.min(255,G)),h[g+3]=255}}}else if(32845==l){function H(t){return t<.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055}for(c=0;c<i;c++)for(S=0;S<r;S++){g=4*(c*r+S);var W=s[1+(B=6*(c*r+S))]<<8|s[B],q=(W=Math.pow(2,(W+.5)/256-64),(s[B+3]+.5)/410),Z=(s[B+5]+.5)/410,Y=9*q/(6*q-16*Z+12),V=4*Z/(6*q-16*Z+12),X=Y*W/V,J=(1-Y-V)*W/V;F=2.69*X-1.276*(P=W)-.414*J,j=-1.022*X+1.978*P+.044*J,G=.061*X-.224*P+1.163*J,h[g]=255*H(Math.min(F,1)),h[g+1]=255*H(Math.min(j,1)),h[g+2]=255*H(Math.min(G,1)),h[g+3]=255}}else n("Unknown Photometric interpretation: "+l);return h},t.replaceIMG=function(e){null==e&&(e=document.getElementsByTagName("img"));for(var r=["tif","tiff","dng","cr2","nef"],i=0;i<e.length;i++){var n=e[i],a=n.getAttribute("src");if(null!=a){var o=a.split(".").pop().toLowerCase();if(-1!=r.indexOf(o)){var s=new XMLHttpRequest;t._xhrs.push(s),t._imgs.push(n),s.open("GET",a),s.responseType="arraybuffer",s.onload=t._imgLoaded,s.send()}}}},t._xhrs=[],t._imgs=[],t._imgLoaded=function(e){var r=t._xhrs.indexOf(e.target),i=t._imgs[r];t._xhrs.splice(r,1),t._imgs.splice(r,1),i.setAttribute("src",t.bufferToURI(e.target.response))},t.bufferToURI=function(e){var r=t.decode(e),i=r,n=0,a=i[0];r[0].subIFD&&(i=i.concat(r[0].subIFD));for(var o=0;o<i.length;o++){var s=i[o];if(!(null==s.t258||s.t258.length<3)){var h=s.t256*s.t257;h>n&&(n=h,a=s)}}t.decodeImage(e,a,r);var l=t.toRGBA8(a),f=a.width,u=a.height,c=document.createElement("canvas");c.width=f,c.height=u;var d=c.getContext("2d"),p=new ImageData(new Uint8ClampedArray(l.buffer),f,u);return d.putImageData(p,0,0),c.toDataURL()},t._binBE={nextZero:function(t,e){for(;0!=t[e];)e++;return e},readUshort:function(t,e){return t[e]<<8|t[e+1]},readShort:function(e,r){var i=t._binBE.ui8;return i[0]=e[r+1],i[1]=e[r+0],t._binBE.i16[0]},readInt:function(e,r){var i=t._binBE.ui8;return i[0]=e[r+3],i[1]=e[r+2],i[2]=e[r+1],i[3]=e[r+0],t._binBE.i32[0]},readUint:function(e,r){var i=t._binBE.ui8;return i[0]=e[r+3],i[1]=e[r+2],i[2]=e[r+1],i[3]=e[r+0],t._binBE.ui32[0]},readASCII:function(t,e,r){for(var i="",n=0;n<r;n++)i+=String.fromCharCode(t[e+n]);return i},readFloat:function(e,r){for(var i=t._binBE.ui8,n=0;n<4;n++)i[n]=e[r+3-n];return t._binBE.fl32[0]},readDouble:function(e,r){for(var i=t._binBE.ui8,n=0;n<8;n++)i[n]=e[r+7-n];return t._binBE.fl64[0]},writeUshort:function(t,e,r){t[e]=r>>8&255,t[e+1]=255&r},writeInt:function(e,r,i){var n=t._binBE.ui8;t._binBE.i32[0]=i,e[r+3]=n[0],e[r+2]=n[1],e[r+1]=n[2],e[r+0]=n[3]},writeUint:function(t,e,r){t[e]=r>>24&255,t[e+1]=r>>16&255,t[e+2]=r>>8&255,t[e+3]=r>>0&255},writeASCII:function(t,e,r){for(var i=0;i<r.length;i++)t[e+i]=r.charCodeAt(i)},writeDouble:function(e,r,i){t._binBE.fl64[0]=i;for(var n=0;n<8;n++)e[r+n]=t._binBE.ui8[7-n]}},t._binBE.ui8=new Uint8Array(8),t._binBE.i16=new Int16Array(t._binBE.ui8.buffer),t._binBE.i32=new Int32Array(t._binBE.ui8.buffer),t._binBE.ui32=new Uint32Array(t._binBE.ui8.buffer),t._binBE.fl32=new Float32Array(t._binBE.ui8.buffer),t._binBE.fl64=new Float64Array(t._binBE.ui8.buffer),t._binLE={nextZero:t._binBE.nextZero,readUshort:function(t,e){return t[e+1]<<8|t[e]},readShort:function(e,r){var i=t._binBE.ui8;return i[0]=e[r+0],i[1]=e[r+1],t._binBE.i16[0]},readInt:function(e,r){var i=t._binBE.ui8;return i[0]=e[r+0],i[1]=e[r+1],i[2]=e[r+2],i[3]=e[r+3],t._binBE.i32[0]},readUint:function(e,r){var i=t._binBE.ui8;return i[0]=e[r+0],i[1]=e[r+1],i[2]=e[r+2],i[3]=e[r+3],t._binBE.ui32[0]},readASCII:t._binBE.readASCII,readFloat:function(e,r){for(var i=t._binBE.ui8,n=0;n<4;n++)i[n]=e[r+n];return t._binBE.fl32[0]},readDouble:function(e,r){for(var i=t._binBE.ui8,n=0;n<8;n++)i[n]=e[r+n];return t._binBE.fl64[0]},writeUshort:function(t,e,r){t[e]=255&r,t[e+1]=r>>8&255},writeInt:function(e,r,i){var n=t._binBE.ui8;t._binBE.i32[0]=i,e[r+0]=n[0],e[r+1]=n[1],e[r+2]=n[2],e[r+3]=n[3]},writeUint:function(t,e,r){t[e]=r>>>0&255,t[e+1]=r>>>8&255,t[e+2]=r>>>16&255,t[e+3]=r>>>24&255},writeASCII:t._binBE.writeASCII},t._copyTile=function(t,e,r,i,n,a,o,s){for(var h=Math.min(e,n-o),l=Math.min(r,a-s),f=0;f<l;f++)for(var u=(s+f)*n+o,c=f*e,d=0;d<h;d++)i[u+d]=t[c+d]},t.LosslessJpegDecode=function(){var t,e;function r(){return t[e++]}function i(){return t[e++]<<8|t[e++]}function n(t){for(var e=r(),i=[0,0,0,255],n=[],o=0;o<16;o++)n[o]=r();for(o=0;o<16;o++)for(var s=0;s<n[o];s++)i[a(i,0,o+1,1)+3]=r();var h=new Uint8Array(256);for(t[e]=[new Uint8Array(i),h],o=0;o<256;o++){for(var l=8,f=o,u=0;255==i[u+3]&&0!=l;)u=i[u+(f>>--l&1)];h[o]=u}}function a(t,e,r,i){if(255!=t[e+3])return 0;if(0==r)return e;for(var n=0;n<2;n++){0==t[e+n]&&(t[e+n]=t.length,t.push(0,0,i,255));var o=a(t,t[e+n],r-1,i+1);if(0!=o)return o}return 0}function o(t){for(var e=t.b,r=t.a;e<25&&t.e<t.d;){var i=t.data[t.e++];t.c||(t.e+=i+1>>>8),r=r<<8|i,e+=8}if(e<0)throw"e";t.b=e,t.a=r}function s(t,e){return e.b<t&&o(e),e.a>>(e.b-=t)&65535>>16-t}function h(t,e){var r=t[0],i=0,n=255;e.b<16&&o(e);var a=e.a>>e.b-8&255;for(n=r[(i=t[1][a])+3],e.b-=r[i+2];255==n;)n=r[(i=r[i+(e.a>>--e.b&1)])+3];return n}function l(t,e){return t<32768>>16-e&&(t+=1-(1<<e)),t}function f(t,e){var r=h(t,e);return 0==r?0:16==r?-32768:l(s(r,e),r)}function u(t,e,r,i,n,a){for(var o=0;o<a;o++)for(var s=o*e,h=0;h<e;h+=n)for(var l=0;l<n;l++)t[s+h+l]=f(i[l],r)}function c(t,e){return l(s(t,e),t)}function d(t,e,r,i,n,a,o,s){for(var h=r*o,l=n;l<a;l++)t[l]+=1<<s-1;for(var f=o;f<h;f+=o)for(l=n;l<a;l++)t[f+l]+=t[f+l-o];for(var u=1;u<i;u++){var c=u*h;for(l=n;l<a;l++)t[c+l]+=t[c+l-h];for(f=o;f<h;f+=o)for(l=n;l<a;l++){var d=c+f+l,p=d-h,m=t[d-o],g=0;if(0==e)g=0;else if(1==e)g=m;else if(2==e)g=t[p];else if(3==e)g=t[p-o];else if(4==e)g=m+(t[p]-t[p-o]);else if(5==e)g=m+(t[p]-t[p-o]>>>1);else if(6==e)g=t[p]+(m-t[p-o]>>>1);else{if(7!=e)throw e;g=m+t[p]>>>1}t[d]+=g}}}return function(a){if(t=a,e=0,65496!=i())throw"e";for(var o=[],s=0,l=0,f=[],p=[],m=[],g=0,b=0,_=0;;){var y=i();if(65535!=y){var w=i();if(65475==y){l=r(),b=i(),_=i(),g=r();for(var v=0;v<g;v++){var x=r(),E=r();if(0!=r())throw"e";o[x]=[v,E>>4,15&E]}}else if(65476==y)for(var k=e+w-2;e<k;)n(p);else{if(65498==y){for(e++,v=0;v<g;v++){var S=o[r()];m[S[0]]=p[r()>>>4],f[S[0]]=S.slice(1)}s=r(),e+=2;break}e+=w-2}}else e--}var M=new(l>8?Uint16Array:Uint8Array)(b*_*g),A={b:0,a:0,c:8==s,e,data:t,d:t.length};if(A.c)!function(r,i,n,a,o){for(var s=t.length-e,l=0;l<s;l+=4){var f=t[e+l];t[e+l]=t[e+l+3],t[e+l+3]=f,f=t[e+l+1],t[e+l+1]=t[e+l+2],t[e+l+2]=f}for(var u=0;u<o;u++)for(var d=32768,p=32768,m=0;m<i;m+=2){var g=h(a,n),b=h(a,n);0!=g&&(d+=c(g,n)),0!=b&&(p+=c(b,n)),r[u*i+m]=65535&d,r[u*i+m+1]=65535&p}}(M,_*g,A,m[0],b);else{var I=[],B=0,T=0;for(v=0;v<g;v++){var R=f[v];(N=R[0])>B&&(B=N),(D=R[1])>T&&(T=D),I.push(N*D)}if(1!=B||1!=T){var P=[],O=0;for(v=0;v<g;v++){for(var L=0;L<I[v];L++)P.push(m[v]);O+=I[v]}var C=_/B,U=b/T;u(M,C*O,A,P,O,U),d(M,s,C,U,O-2,O,O,l);for(var z=M.slice(0),D=0;D<b;D++)for(var N=0;N<_;N++){var F=(D*_+N)*g,j=~~(D/T)*C+~~(N/B),G=0;for(v=0;v<g;v++){var H=1&N,W=j*O+G+(0==v?1==T?H:2*H+(1&D):0);M[F+v]=z[W],G+=I[v]}}d(M,s,_,b,0,1,g,l)}else u(M,_*g,A,m,g,b),d(M,s,_,b,0,g,g,l)}return M}}(),function(){var e=2,r=3,i=4,n=5,a=6,o=7,s=8,h=9,l=10,f=11,u=12,c=13,d=14,p=15,m=16,g=17;function b(t){for(var e=[[],[],[]],r=Math.max(2,t.w+32>>>6),i=0;i<3;i++)for(var n=0;n<41;n++)e[i][n]=[r,1];return e}function _(t,e){var r=0,i=8-t.a;if(t.j,t.a,e){if(e>=i)do{r<<=i,e-=i,r|=t[t.j]&(1<<i)-1,t.j++,i=8}while(e>=8);e&&(r<<=e,i-=e,r|=t[t.j]>>>i&(1<<e)-1),t.a=8-i}return r}function y(t,e,r,i,n,a,o,s){null==s&&(s=0);var h,l,f,u,c,d,p=a+1,m=p%2,g=0,b=i[n],y=i[n-1],w=i[n-2][p],v=y[p-1],x=y[p],E=y[p+1],k=b[p-1],S=b[p+1],M=Math.abs;if(m&&(f=M(E-x),u=M(w-x),c=M(v-x)),m){if(d=(d=f>c&&u<f?w+v:f<c&&u<c?w+E:E+v)+2*x>>>2,s)return void(b[p]=d);h=e.t*e.c[t.g+x-w]+e.c[t.g+v-x]}else d=x>v&&x>E||x<v&&x<E?S+k+2*x>>>2:k+S>>>1,h=e.t*e.c[t.g+x-v]+e.c[t.g+v-k];l=M(h);var A=function(t){for(var e=-1,r=0;!r;e++)r=t[t.j]>>>7-t.a&1,t.a++,t.a&=7,t.a||t.j++;return e}(r);if(A<t.n-e.v-1){var I=function(t,e){var r=0;if(e<t)for(;r<=14&&e<<++r<t;);return r}(o[l][0],o[l][1]);g=_(r,I)+(A<<I)}else g=_(r,e.v)+1;g=1&g?-1-(g>>>1):g>>>1,o[l][0]+=M(g),o[l][1]==t.f&&(o[l][0]>>>=1,o[l][1]>>>=1),o[l][1]++,d=h<0?d-g:d+g,t.i&&(d<0?d+=e.w:d>t.g&&(d-=e.w)),b[p]=d>=0?Math.min(d,t.g):0}function w(t,e,r){for(var i=t[0].length,n=e;n<=r;n++)t[n][0]=t[n-1][1],t[n][i-1]=t[n-1][i-2]}function v(t){w(t,o,u),w(t,e,i),w(t,p,g)}function x(t,e,r,n,a,o,s,h,l,f,u,d,p){for(var m=0,g=1,b=a<c&&a>i;g<t.m;)m<t.m&&(y(t,e,r,n,a,m,s[l],t.h&&(b&&f||!b&&(u||(m&d)==p))),y(t,e,r,n,o,m,s[l],t.h&&(!b&&f||b&&(u||(m&d)==p))),m+=2),m>8&&(y(t,e,r,n,a,g,h[l]),y(t,e,r,n,o,g,h[l]),g+=2);v(n)}function E(t,n,a,c,d,b){x(t,n,a,c,e,o,d,b,0,0,1,0,8),x(t,n,a,c,s,p,d,b,1,0,1,0,8),x(t,n,a,c,r,h,d,b,2,1,0,3,0),x(t,n,a,c,l,m,d,b,0,0,0,3,2),x(t,n,a,c,i,f,d,b,1,0,0,3,2),x(t,n,a,c,u,g,d,b,2,1,0,3,0)}function k(t,r,i,n,a,s){var h=s.length,l=t.l;a+1==t.s&&(l=t.e-a*t.l);for(var f=6*t.e*n+a*t.l,u=0;u<6;u++){for(var c=0;c<l;c++){var d,m=s[u%h][c%h];d=0==m?e+(u>>>1):2==m?p+(u>>>1):o+u;var g=t.h?(2*c/3&2147483646|c%3&1)+(c%3>>>1):c>>>1;r[f+c]=i[d][g+1]}f+=t.e}}t._decompressRAF=function(o,s){var h=function(e){var r=t._binBE.readUshort,i={b:r(e,0),i:e[2],C:e[3],u:e[4],q:r(e,5),k:r(e,7),e:r(e,9),l:r(e,11),s:e[13],d:r(e,14)};if(18771!=i.b||i.i>1||i.q<6||i.q%6||i.e<768||i.e%24||768!=i.l||i.k<i.l||i.k%i.l||i.k-i.e>=i.l||i.s>16||i.s!=i.k/i.l||i.s!=Math.ceil(i.e/i.l)||i.d!=i.q/6||12!=i.u&&14!=i.u&&16!=i.u||16!=i.C&&0!=i.C)throw"Invalid data";if(0==i.i)throw"Not implemented. We need this file!";return i.h=16==i.C,i.m=0|(i.h?2*i.l/3:i.l>>>1),i.A=i.m+2,i.f=64,i.g=(1<<i.u)-1,i.n=4*i.u,i}(o),l=function(e,r){var i=new Array(r.s),n=4*r.s,a=16+n;12&n&&(a+=16-(12&n));for(var o=0,s=16;o<r.s;s+=4){var h=t._binBE.readUint(e,s);i[o]=e.slice(a,a+h),i[o].j=0,i[o].a=0,a+=h,o++}if(a!=e.length)throw"Invalid data";return i}(o,h),p=function(t){var e={c:new Int8Array(2<<t.u)};return function(t,e,r){var i=[0,18,67,276,r];t.o=0,t.w=(i[4]+0)/1+1|0,t.v=Math.ceil(Math.log2(t.w)),t.t=9,function(t,e){for(var r=-e[4],i=0;r<=e[4];i++,r++)t[i]=r<=-e[3]?-4:r<=-e[2]?-3:r<=-e[1]?-2:r<-e[0]?-1:r<=e[0]?0:r<e[1]?1:r<e[2]?2:r<e[3]?3:4}(t.c,i)}(e,0,t.g),e}(h),_=new Int16Array(h.e*h.q);null==s&&(s=h.h?[[1,1,0,1,1,2],[1,1,2,1,1,0],[2,0,1,0,2,1],[1,1,2,1,1,0],[1,1,0,1,1,2],[0,2,1,2,0,1]]:[[0,1],[3,2]]);for(var y=[[0,r],[1,i],[n,f],[a,u],[c,m],[d,g]],w=[],x=0;x<18;x++)w[x]=new Uint16Array(h.A);for(var S=0;S<h.s;S++){var M=b(p),A=b(p);for(x=0;x<18;x++)for(var I=0;I<h.A;I++)w[x][I]=0;for(var B=0;B<h.d;B++){for(E(h,p,l[S],w,M,A),x=0;x<6;x++)for(I=0;I<h.A;I++)w[y[x][0]][I]=w[y[x][1]][I];for(k(h,_,w,B,S,s),x=e;x<18;x++)if(-1==[n,a,c,d].indexOf(x))for(I=0;I<h.A;I++)w[x][I]=0;v(w)}}return _}}()}(e,r(2845))}()},6168:(t,e,r)=>{"use strict";r.r(e),r.d(e,{DOMException:()=>v,Headers:()=>f,Request:()=>b,Response:()=>y,fetch:()=>x});var i="undefined"!=typeof globalThis&&globalThis||"undefined"!=typeof self&&self||void 0!==i&&i,n={searchParams:"URLSearchParams"in i,iterable:"Symbol"in i&&"iterator"in Symbol,blob:"FileReader"in i&&"Blob"in i&&function(){try{return new Blob,!0}catch(t){return!1}}(),formData:"FormData"in i,arrayBuffer:"ArrayBuffer"in i};if(n.arrayBuffer)var a=["[object Int8Array]","[object Uint8Array]","[object Uint8ClampedArray]","[object Int16Array]","[object Uint16Array]","[object Int32Array]","[object Uint32Array]","[object Float32Array]","[object Float64Array]"],o=ArrayBuffer.isView||function(t){return t&&a.indexOf(Object.prototype.toString.call(t))>-1};function s(t){if("string"!=typeof t&&(t=String(t)),/[^a-z0-9\-#$%&'*+.^_`|~!]/i.test(t)||""===t)throw new TypeError('Invalid character in header field name: "'+t+'"');return t.toLowerCase()}function h(t){return"string"!=typeof t&&(t=String(t)),t}function l(t){var e={next:function(){var e=t.shift();return{done:void 0===e,value:e}}};return n.iterable&&(e[Symbol.iterator]=function(){return e}),e}function f(t){this.map={},t instanceof f?t.forEach((function(t,e){this.append(e,t)}),this):Array.isArray(t)?t.forEach((function(t){this.append(t[0],t[1])}),this):t&&Object.getOwnPropertyNames(t).forEach((function(e){this.append(e,t[e])}),this)}function u(t){if(t.bodyUsed)return Promise.reject(new TypeError("Already read"));t.bodyUsed=!0}function c(t){return new Promise((function(e,r){t.onload=function(){e(t.result)},t.onerror=function(){r(t.error)}}))}function d(t){var e=new FileReader,r=c(e);return e.readAsArrayBuffer(t),r}function p(t){if(t.slice)return t.slice(0);var e=new Uint8Array(t.byteLength);return e.set(new Uint8Array(t)),e.buffer}function m(){return this.bodyUsed=!1,this._initBody=function(t){var e;this.bodyUsed=this.bodyUsed,this._bodyInit=t,t?"string"==typeof t?this._bodyText=t:n.blob&&Blob.prototype.isPrototypeOf(t)?this._bodyBlob=t:n.formData&&FormData.prototype.isPrototypeOf(t)?this._bodyFormData=t:n.searchParams&&URLSearchParams.prototype.isPrototypeOf(t)?this._bodyText=t.toString():n.arrayBuffer&&n.blob&&(e=t)&&DataView.prototype.isPrototypeOf(e)?(this._bodyArrayBuffer=p(t.buffer),this._bodyInit=new Blob([this._bodyArrayBuffer])):n.arrayBuffer&&(ArrayBuffer.prototype.isPrototypeOf(t)||o(t))?this._bodyArrayBuffer=p(t):this._bodyText=t=Object.prototype.toString.call(t):this._bodyText="",this.headers.get("content-type")||("string"==typeof t?this.headers.set("content-type","text/plain;charset=UTF-8"):this._bodyBlob&&this._bodyBlob.type?this.headers.set("content-type",this._bodyBlob.type):n.searchParams&&URLSearchParams.prototype.isPrototypeOf(t)&&this.headers.set("content-type","application/x-www-form-urlencoded;charset=UTF-8"))},n.blob&&(this.blob=function(){var t=u(this);if(t)return t;if(this._bodyBlob)return Promise.resolve(this._bodyBlob);if(this._bodyArrayBuffer)return Promise.resolve(new Blob([this._bodyArrayBuffer]));if(this._bodyFormData)throw new Error("could not read FormData body as blob");return Promise.resolve(new Blob([this._bodyText]))},this.arrayBuffer=function(){return this._bodyArrayBuffer?u(this)||(ArrayBuffer.isView(this._bodyArrayBuffer)?Promise.resolve(this._bodyArrayBuffer.buffer.slice(this._bodyArrayBuffer.byteOffset,this._bodyArrayBuffer.byteOffset+this._bodyArrayBuffer.byteLength)):Promise.resolve(this._bodyArrayBuffer)):this.blob().then(d)}),this.text=function(){var t,e,r,i=u(this);if(i)return i;if(this._bodyBlob)return t=this._bodyBlob,r=c(e=new FileReader),e.readAsText(t),r;if(this._bodyArrayBuffer)return Promise.resolve(function(t){for(var e=new Uint8Array(t),r=new Array(e.length),i=0;i<e.length;i++)r[i]=String.fromCharCode(e[i]);return r.join("")}(this._bodyArrayBuffer));if(this._bodyFormData)throw new Error("could not read FormData body as text");return Promise.resolve(this._bodyText)},n.formData&&(this.formData=function(){return this.text().then(_)}),this.json=function(){return this.text().then(JSON.parse)},this}f.prototype.append=function(t,e){t=s(t),e=h(e);var r=this.map[t];this.map[t]=r?r+", "+e:e},f.prototype.delete=function(t){delete this.map[s(t)]},f.prototype.get=function(t){return t=s(t),this.has(t)?this.map[t]:null},f.prototype.has=function(t){return this.map.hasOwnProperty(s(t))},f.prototype.set=function(t,e){this.map[s(t)]=h(e)},f.prototype.forEach=function(t,e){for(var r in this.map)this.map.hasOwnProperty(r)&&t.call(e,this.map[r],r,this)},f.prototype.keys=function(){var t=[];return this.forEach((function(e,r){t.push(r)})),l(t)},f.prototype.values=function(){var t=[];return this.forEach((function(e){t.push(e)})),l(t)},f.prototype.entries=function(){var t=[];return this.forEach((function(e,r){t.push([r,e])})),l(t)},n.iterable&&(f.prototype[Symbol.iterator]=f.prototype.entries);var g=["DELETE","GET","HEAD","OPTIONS","POST","PUT"];function b(t,e){if(!(this instanceof b))throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.');var r,i,n=(e=e||{}).body;if(t instanceof b){if(t.bodyUsed)throw new TypeError("Already read");this.url=t.url,this.credentials=t.credentials,e.headers||(this.headers=new f(t.headers)),this.method=t.method,this.mode=t.mode,this.signal=t.signal,n||null==t._bodyInit||(n=t._bodyInit,t.bodyUsed=!0)}else this.url=String(t);if(this.credentials=e.credentials||this.credentials||"same-origin",!e.headers&&this.headers||(this.headers=new f(e.headers)),this.method=(i=(r=e.method||this.method||"GET").toUpperCase(),g.indexOf(i)>-1?i:r),this.mode=e.mode||this.mode||null,this.signal=e.signal||this.signal,this.referrer=null,("GET"===this.method||"HEAD"===this.method)&&n)throw new TypeError("Body not allowed for GET or HEAD requests");if(this._initBody(n),!("GET"!==this.method&&"HEAD"!==this.method||"no-store"!==e.cache&&"no-cache"!==e.cache)){var a=/([?&])_=[^&]*/;a.test(this.url)?this.url=this.url.replace(a,"$1_="+(new Date).getTime()):this.url+=(/\?/.test(this.url)?"&":"?")+"_="+(new Date).getTime()}}function _(t){var e=new FormData;return t.trim().split("&").forEach((function(t){if(t){var r=t.split("="),i=r.shift().replace(/\+/g," "),n=r.join("=").replace(/\+/g," ");e.append(decodeURIComponent(i),decodeURIComponent(n))}})),e}function y(t,e){if(!(this instanceof y))throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.');e||(e={}),this.type="default",this.status=void 0===e.status?200:e.status,this.ok=this.status>=200&&this.status<300,this.statusText=void 0===e.statusText?"":""+e.statusText,this.headers=new f(e.headers),this.url=e.url||"",this._initBody(t)}b.prototype.clone=function(){return new b(this,{body:this._bodyInit})},m.call(b.prototype),m.call(y.prototype),y.prototype.clone=function(){return new y(this._bodyInit,{status:this.status,statusText:this.statusText,headers:new f(this.headers),url:this.url})},y.error=function(){var t=new y(null,{status:0,statusText:""});return t.type="error",t};var w=[301,302,303,307,308];y.redirect=function(t,e){if(-1===w.indexOf(e))throw new RangeError("Invalid status code");return new y(null,{status:e,headers:{location:t}})};var v=i.DOMException;try{new v}catch(t){(v=function(t,e){this.message=t,this.name=e;var r=Error(t);this.stack=r.stack}).prototype=Object.create(Error.prototype),v.prototype.constructor=v}function x(t,e){return new Promise((function(r,a){var o=new b(t,e);if(o.signal&&o.signal.aborted)return a(new v("Aborted","AbortError"));var s=new XMLHttpRequest;function l(){s.abort()}s.onload=function(){var t,e,i={status:s.status,statusText:s.statusText,headers:(t=s.getAllResponseHeaders()||"",e=new f,t.replace(/\r?\n[\t ]+/g," ").split("\r").map((function(t){return 0===t.indexOf("\n")?t.substr(1,t.length):t})).forEach((function(t){var r=t.split(":"),i=r.shift().trim();if(i){var n=r.join(":").trim();e.append(i,n)}})),e)};i.url="responseURL"in s?s.responseURL:i.headers.get("X-Request-URL");var n="response"in s?s.response:s.responseText;setTimeout((function(){r(new y(n,i))}),0)},s.onerror=function(){setTimeout((function(){a(new TypeError("Network request failed"))}),0)},s.ontimeout=function(){setTimeout((function(){a(new TypeError("Network request failed"))}),0)},s.onabort=function(){setTimeout((function(){a(new v("Aborted","AbortError"))}),0)},s.open(o.method,function(t){try{return""===t&&i.location.href?i.location.href:t}catch(e){return t}}(o.url),!0),"include"===o.credentials?s.withCredentials=!0:"omit"===o.credentials&&(s.withCredentials=!1),"responseType"in s&&(n.blob?s.responseType="blob":n.arrayBuffer&&o.headers.get("Content-Type")&&-1!==o.headers.get("Content-Type").indexOf("application/octet-stream")&&(s.responseType="arraybuffer")),!e||"object"!=typeof e.headers||e.headers instanceof f?o.headers.forEach((function(t,e){s.setRequestHeader(e,t)})):Object.getOwnPropertyNames(e.headers).forEach((function(t){s.setRequestHeader(t,h(e.headers[t]))})),o.signal&&(o.signal.addEventListener("abort",l),s.onreadystatechange=function(){4===s.readyState&&o.signal.removeEventListener("abort",l)}),s.send(void 0===o._bodyInit?null:o._bodyInit)}))}x.polyfill=!0,i.fetch||(i.fetch=x,i.Headers=f,i.Request=b,i.Response=y)},6290:(t,e,r)=>{"use strict";var i=r(5048),n=r(9748),a=r(4655),o=r(1960);function s(t,e,r){var i=t;return n(e)?(r=e,"string"==typeof t&&(i={uri:t})):i=o(e,{uri:t}),i.callback=r,i}function h(t,e,r){return l(e=s(t,e,r))}function l(t){if(void 0===t.callback)throw new Error("callback argument missing");var e=!1,r=function(r,i,n){e||(e=!0,t.callback(r,i,n))};function i(){var t=void 0;if(t=f.response?f.response:f.responseText||function(t){try{if("document"===t.responseType)return t.responseXML;var e=t.responseXML&&"parsererror"===t.responseXML.documentElement.nodeName;if(""===t.responseType&&!e)return t.responseXML}catch(t){}return null}(f),b)try{t=JSON.parse(t)}catch(t){}return t}function n(t){return clearTimeout(u),t instanceof Error||(t=new Error(""+(t||"Unknown XMLHttpRequest Error"))),t.statusCode=0,r(t,_)}function o(){if(!l){var e;clearTimeout(u),e=t.useXDR&&void 0===f.status?200:1223===f.status?204:f.status;var n=_,o=null;return 0!==e?(n={body:i(),statusCode:e,method:d,headers:{},url:c,rawRequest:f},f.getAllResponseHeaders&&(n.headers=a(f.getAllResponseHeaders()))):o=new Error("Internal XMLHttpRequest Error"),r(o,n,n.body)}}var s,l,f=t.xhr||null;f||(f=t.cors||t.useXDR?new h.XDomainRequest:new h.XMLHttpRequest);var u,c=f.url=t.uri||t.url,d=f.method=t.method||"GET",p=t.body||t.data,m=f.headers=t.headers||{},g=!!t.sync,b=!1,_={body:void 0,headers:{},statusCode:0,method:d,url:c,rawRequest:f};if("json"in t&&!1!==t.json&&(b=!0,m.accept||m.Accept||(m.Accept="application/json"),"GET"!==d&&"HEAD"!==d&&(m["content-type"]||m["Content-Type"]||(m["Content-Type"]="application/json"),p=JSON.stringify(!0===t.json?p:t.json))),f.onreadystatechange=function(){4===f.readyState&&setTimeout(o,0)},f.onload=o,f.onerror=n,f.onprogress=function(){},f.onabort=function(){l=!0},f.ontimeout=n,f.open(d,c,!g,t.username,t.password),g||(f.withCredentials=!!t.withCredentials),!g&&t.timeout>0&&(u=setTimeout((function(){if(!l){l=!0,f.abort("timeout");var t=new Error("XMLHttpRequest timeout");t.code="ETIMEDOUT",n(t)}}),t.timeout)),f.setRequestHeader)for(s in m)m.hasOwnProperty(s)&&f.setRequestHeader(s,m[s]);else if(t.headers&&!function(t){for(var e in t)if(t.hasOwnProperty(e))return!1;return!0}(t.headers))throw new Error("Headers cannot be set on an XDomainRequest object");return"responseType"in t&&(f.responseType=t.responseType),"beforeSend"in t&&"function"==typeof t.beforeSend&&t.beforeSend(f),f.send(p||null),f}t.exports=h,t.exports.default=h,h.XMLHttpRequest=i.XMLHttpRequest||function(){},h.XDomainRequest="withCredentials"in new h.XMLHttpRequest?h.XMLHttpRequest:i.XDomainRequest,function(t,e){for(var r=0;r<t.length;r++)e(t[r])}(["get","put","post","patch","head","delete"],(function(t){h["delete"===t?"del":t]=function(e,r,i){return(r=s(e,r,i)).method=t.toUpperCase(),l(r)}}))},1596:t=>{t.exports=void 0!==self.DOMParser?function(t){return(new self.DOMParser).parseFromString(t,"application/xml")}:void 0!==self.ActiveXObject&&new self.ActiveXObject("Microsoft.XMLDOM")?function(t){var e=new self.ActiveXObject("Microsoft.XMLDOM");return e.async="false",e.loadXML(t),e}:function(t){var e=document.createElement("div");return e.innerHTML=t,e}},1960:t=>{t.exports=function(){for(var t={},r=0;r<arguments.length;r++){var i=arguments[r];for(var n in i)e.call(i,n)&&(t[n]=i[n])}return t};var e=Object.prototype.hasOwnProperty},8522:()=>{},6777:()=>{},5546:()=>{},2460:(t,e,r)=>{var i=r(4406),n=Object.defineProperty,a=Object.getOwnPropertyDescriptor,o=Object.getOwnPropertyNames,s=Object.prototype.hasOwnProperty,h=(t,e)=>{for(var r in e)n(t,r,{get:e[r],enumerable:!0})},l=(t=>(e,r)=>t&&t.get(e)||(r=((t,e,r,i)=>{if(e&&"object"==typeof e||"function"==typeof e)for(let r of o(e))s.call(t,r)||n(t,r,{get:()=>e[r],enumerable:!(i=a(e,r))||i.enumerable});return t})(n({},"__esModule",{value:!0}),e),t&&t.set(e,r),r))("undefined"!=typeof WeakMap?new WeakMap:0),f=(t,e,r)=>(((t,e,r)=>{e in t?n(t,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):t[e]=r})(t,"symbol"!=typeof e?e+"":e,r),r),u={};h(u,{applyPalette:()=>te,applyPaletteSync:()=>$t,buildPalette:()=>Kt,buildPaletteSync:()=>Qt,constants:()=>c,conversion:()=>b,distance:()=>H,image:()=>Ct,palette:()=>ot,quality:()=>Wt,utils:()=>ct});var c={};h(c,{bt709:()=>d});var d={};h(d,{Y:()=>p,x:()=>m,y:()=>g});var p=(t=>(t[t.RED=.2126]="RED",t[t.GREEN=.7152]="GREEN",t[t.BLUE=.0722]="BLUE",t[t.WHITE=1]="WHITE",t))(p||{}),m=(t=>(t[t.RED=.64]="RED",t[t.GREEN=.3]="GREEN",t[t.BLUE=.15]="BLUE",t[t.WHITE=.3127]="WHITE",t))(m||{}),g=(t=>(t[t.RED=.33]="RED",t[t.GREEN=.6]="GREEN",t[t.BLUE=.06]="BLUE",t[t.WHITE=.329]="WHITE",t))(g||{}),b={};function _(t){return t>.04045?((t+.055)/1.055)**2.4:t/12.92}function y(t,e,r){return{x:.4124*(t=_(t/255))+.3576*(e=_(e/255))+.1805*(r=_(r/255)),y:.2126*t+.7152*e+.0722*r,z:.0193*t+.1192*e+.9505*r}}h(b,{lab2rgb:()=>G,lab2xyz:()=>N,rgb2hsl:()=>I,rgb2lab:()=>L,rgb2xyz:()=>y,xyz2lab:()=>O,xyz2rgb:()=>j});var w={};function v(t){return t*(Math.PI/180)}function x(t,e,r){let i=t;return i<e&&(i=e),i<r&&(i=r),i}function E(t,e,r){let i=t;return i>e&&(i=e),i>r&&(i=r),i}function k(t,e,r){return t>r&&(t=r),t<e&&(t=e),0|t}function S(t){return(t=Math.round(t))>255?t=255:t<0&&(t=0),t}function M(t){return t>255?t=255:t<0&&(t=0),t}function A(t,e){const r=typeof t[0];let i;if("number"===r||"string"===r){const r=Object.create(null);for(let e=0,i=t.length;e<i;e++){const i=t[e];r[i]||0===r[i]||(r[i]=e)}i=t.sort(((t,i)=>e(t,i)||r[t]-r[i]))}else{const r=t.slice(0);i=t.sort(((t,i)=>e(t,i)||r.indexOf(t)-r.indexOf(i)))}return i}function I(t,e,r){const i=E(t,e,r),n=x(t,e,r),a=n-i,o=(i+n)/510;let s=0;o>0&&o<1&&(s=a/(o<.5?n+i:510-n-i));let h=0;return a>0&&(h=n===t?(e-r)/a:n===e?2+(r-t)/a:4+(t-e)/a,h*=60,h<0&&(h+=360)),{h,s,l:o}}h(w,{degrees2radians:()=>v,inRange0to255:()=>M,inRange0to255Rounded:()=>S,intInRange:()=>k,max3:()=>x,min3:()=>E,stableSort:()=>A});var B=.95047,T=1,R=1.08883;function P(t){return t>.008856?t**(1/3):7.787*t+16/116}function O(t,e,r){if(t=P(t/B),e=P(e/T),r=P(r/R),116*e-16<0)throw new Error("xxx");return{L:Math.max(0,116*e-16),a:500*(t-e),b:200*(e-r)}}function L(t,e,r){const i=y(t,e,r);return O(i.x,i.y,i.z)}var C=.95047,U=1,z=1.08883;function D(t){return t>.206893034?t**3:(t-16/116)/7.787}function N(t,e,r){const i=(t+16)/116,n=i-r/200;return{x:C*D(e/500+i),y:U*D(i),z:z*D(n)}}function F(t){return t>.0031308?1.055*t**(1/2.4)-.055:12.92*t}function j(t,e,r){const i=F(3.2406*t+-1.5372*e+-.4986*r),n=F(-.9689*t+1.8758*e+.0415*r),a=F(.0557*t+-.204*e+1.057*r);return{r:S(255*i),g:S(255*n),b:S(255*a)}}function G(t,e,r){const i=N(t,e,r);return j(i.x,i.y,i.z)}var H={};h(H,{AbstractDistanceCalculator:()=>W,AbstractEuclidean:()=>Q,AbstractManhattan:()=>et,CIE94GraphicArts:()=>Y,CIE94Textiles:()=>Z,CIEDE2000:()=>X,CMetric:()=>J,Euclidean:()=>K,EuclideanBT709:()=>$,EuclideanBT709NoAlpha:()=>tt,Manhattan:()=>rt,ManhattanBT709:()=>nt,ManhattanNommyde:()=>it,PNGQuant:()=>at});var W=class{constructor(){f(this,"_maxDistance"),f(this,"_whitePoint"),this._setDefaults(),this.setWhitePoint(255,255,255,255)}setWhitePoint(t,e,r,i){this._whitePoint={r:t>0?255/t:0,g:e>0?255/e:0,b:r>0?255/r:0,a:i>0?255/i:0},this._maxDistance=this.calculateRaw(t,e,r,i,0,0,0,0)}calculateNormalized(t,e){return this.calculateRaw(t.r,t.g,t.b,t.a,e.r,e.g,e.b,e.a)/this._maxDistance}},q=class extends W{calculateRaw(t,e,r,i,n,a,o,s){const h=L(M(t*this._whitePoint.r),M(e*this._whitePoint.g),M(r*this._whitePoint.b)),l=L(M(n*this._whitePoint.r),M(a*this._whitePoint.g),M(o*this._whitePoint.b)),f=h.L-l.L,u=h.a-l.a,c=h.b-l.b,d=Math.sqrt(h.a*h.a+h.b*h.b),p=d-Math.sqrt(l.a*l.a+l.b*l.b);let m=u*u+c*c-p*p;m=m<0?0:Math.sqrt(m);const g=(s-i)*this._whitePoint.a*this._kA;return Math.sqrt((f/this._Kl)**2+(p/(1+this._K1*d))**2+(m/(1+this._K2*d))**2+g**2)}},Z=class extends q{_setDefaults(){this._Kl=2,this._K1=.048,this._K2=.014,this._kA=12.5/255}},Y=class extends q{_setDefaults(){this._Kl=1,this._K1=.045,this._K2=.015,this._kA=25/255}},V=class extends W{_setDefaults(){}static _calculatehp(t,e){const r=Math.atan2(t,e);return r>=0?r:r+V._deg360InRad}static _calculateRT(t,e){const r=e**7,i=2*Math.sqrt(r/(r+V._pow25to7)),n=V._deg30InRad*Math.exp(-(((t-V._deg275InRad)/V._deg25InRad)**2));return-Math.sin(2*n)*i}static _calculateT(t){return 1-.17*Math.cos(t-V._deg30InRad)+.24*Math.cos(2*t)+.32*Math.cos(3*t+V._deg6InRad)-.2*Math.cos(4*t-V._deg63InRad)}static _calculate_ahp(t,e,r,i){const n=r+i;return 0===t?n:e<=V._deg180InRad?n/2:n<V._deg360InRad?(n+V._deg360InRad)/2:(n-V._deg360InRad)/2}static _calculate_dHp(t,e,r,i){let n;return n=0===t?0:e<=V._deg180InRad?r-i:r<=i?r-i+V._deg360InRad:r-i-V._deg360InRad,2*Math.sqrt(t)*Math.sin(n/2)}calculateRaw(t,e,r,i,n,a,o,s){const h=L(M(t*this._whitePoint.r),M(e*this._whitePoint.g),M(r*this._whitePoint.b)),l=L(M(n*this._whitePoint.r),M(a*this._whitePoint.g),M(o*this._whitePoint.b)),f=(s-i)*this._whitePoint.a*V._kA,u=this.calculateRawInLab(h,l);return Math.sqrt(u+f*f)}calculateRawInLab(t,e){const r=t.L,i=t.a,n=t.b,a=e.L,o=e.a,s=e.b,h=((Math.sqrt(i*i+n*n)+Math.sqrt(o*o+s*s))/2)**7,l=.5*(1-Math.sqrt(h/(h+V._pow25to7))),f=(1+l)*i,u=(1+l)*o,c=Math.sqrt(f*f+n*n),d=Math.sqrt(u*u+s*s),p=c*d,m=V._calculatehp(n,f),g=V._calculatehp(s,u),b=Math.abs(m-g),_=a-r,y=d-c,w=V._calculate_dHp(p,b,g,m),v=V._calculate_ahp(p,b,m,g),x=(c+d)/2,E=((r+a)/2-50)**2,k=y/(1+.045*x),S=w/(1+.015*V._calculateT(v)*x);return(_/(1+.015*E/Math.sqrt(20+E)))**2+k**2+S**2+V._calculateRT(v,x)*k*S}},X=V;f(X,"_kA",25/255),f(X,"_pow25to7",25**7),f(X,"_deg360InRad",v(360)),f(X,"_deg180InRad",v(180)),f(X,"_deg30InRad",v(30)),f(X,"_deg6InRad",v(6)),f(X,"_deg63InRad",v(63)),f(X,"_deg275InRad",v(275)),f(X,"_deg25InRad",v(25));var J=class extends W{calculateRaw(t,e,r,i,n,a,o,s){const h=(t+n)/2*this._whitePoint.r,l=(t-n)*this._whitePoint.r,f=(e-a)*this._whitePoint.g,u=(r-o)*this._whitePoint.b,c=((512+h)*l*l>>8)+4*f*f+((767-h)*u*u>>8),d=(s-i)*this._whitePoint.a;return Math.sqrt(c+d*d)}_setDefaults(){}},Q=class extends W{calculateRaw(t,e,r,i,n,a,o,s){const h=n-t,l=a-e,f=o-r,u=s-i;return Math.sqrt(this._kR*h*h+this._kG*l*l+this._kB*f*f+this._kA*u*u)}},K=class extends Q{_setDefaults(){this._kR=1,this._kG=1,this._kB=1,this._kA=1}},$=class extends Q{_setDefaults(){this._kR=.2126,this._kG=.7152,this._kB=.0722,this._kA=1}},tt=class extends Q{_setDefaults(){this._kR=.2126,this._kG=.7152,this._kB=.0722,this._kA=0}},et=class extends W{calculateRaw(t,e,r,i,n,a,o,s){let h=n-t,l=a-e,f=o-r,u=s-i;return h<0&&(h=0-h),l<0&&(l=0-l),f<0&&(f=0-f),u<0&&(u=0-u),this._kR*h+this._kG*l+this._kB*f+this._kA*u}},rt=class extends et{_setDefaults(){this._kR=1,this._kG=1,this._kB=1,this._kA=1}},it=class extends et{_setDefaults(){this._kR=.4984,this._kG=.8625,this._kB=.2979,this._kA=1}},nt=class extends et{_setDefaults(){this._kR=.2126,this._kG=.7152,this._kB=.0722,this._kA=1}},at=class extends W{calculateRaw(t,e,r,i,n,a,o,s){const h=(s-i)*this._whitePoint.a;return this._colordifferenceCh(t*this._whitePoint.r,n*this._whitePoint.r,h)+this._colordifferenceCh(e*this._whitePoint.g,a*this._whitePoint.g,h)+this._colordifferenceCh(r*this._whitePoint.b,o*this._whitePoint.b,h)}_colordifferenceCh(t,e,r){const i=t-e,n=i+r;return i*i+n*n}_setDefaults(){}},ot={};h(ot,{AbstractPaletteQuantizer:()=>st,ColorHistogram:()=>kt,NeuQuant:()=>yt,NeuQuantFloat:()=>xt,RGBQuant:()=>Mt,WuColorCube:()=>Pt,WuQuant:()=>Lt});var st=class{quantizeSync(){for(const t of this.quantize())if(t.palette)return t.palette;throw new Error("unreachable")}},ht=class{constructor(){f(this,"r"),f(this,"g"),f(this,"b"),f(this,"a"),f(this,"uint32"),f(this,"rgba"),this.uint32=-1>>>0,this.r=this.g=this.b=this.a=0,this.rgba=new Array(4),this.rgba[0]=0,this.rgba[1]=0,this.rgba[2]=0,this.rgba[3]=0}static createByQuadruplet(t){const e=new ht;return e.r=0|t[0],e.g=0|t[1],e.b=0|t[2],e.a=0|t[3],e._loadUINT32(),e._loadQuadruplet(),e}static createByRGBA(t,e,r,i){const n=new ht;return n.r=0|t,n.g=0|e,n.b=0|r,n.a=0|i,n._loadUINT32(),n._loadQuadruplet(),n}static createByUint32(t){const e=new ht;return e.uint32=t>>>0,e._loadRGBA(),e._loadQuadruplet(),e}from(t){this.r=t.r,this.g=t.g,this.b=t.b,this.a=t.a,this.uint32=t.uint32,this.rgba[0]=t.r,this.rgba[1]=t.g,this.rgba[2]=t.b,this.rgba[3]=t.a}getLuminosity(t){let e=this.r,r=this.g,i=this.b;return t&&(e=Math.min(255,255-this.a+this.a*e/255),r=Math.min(255,255-this.a+this.a*r/255),i=Math.min(255,255-this.a+this.a*i/255)),.2126*e+.7152*r+.0722*i}_loadUINT32(){this.uint32=(this.a<<24|this.b<<16|this.g<<8|this.r)>>>0}_loadRGBA(){this.r=255&this.uint32,this.g=this.uint32>>>8&255,this.b=this.uint32>>>16&255,this.a=this.uint32>>>24&255}_loadQuadruplet(){this.rgba[0]=this.r,this.rgba[1]=this.g,this.rgba[2]=this.b,this.rgba[3]=this.a}},lt=class{constructor(){f(this,"_pointArray"),f(this,"_width"),f(this,"_height"),this._width=0,this._height=0,this._pointArray=[]}getWidth(){return this._width}getHeight(){return this._height}setWidth(t){this._width=t}setHeight(t){this._height=t}getPointArray(){return this._pointArray}clone(){const t=new lt;t._width=this._width,t._height=this._height;for(let e=0,r=this._pointArray.length;e<r;e++)t._pointArray[e]=ht.createByUint32(0|this._pointArray[e].uint32);return t}toUint32Array(){const t=this._pointArray.length,e=new Uint32Array(t);for(let r=0;r<t;r++)e[r]=this._pointArray[r].uint32;return e}toUint8Array(){return new Uint8Array(this.toUint32Array().buffer)}static fromHTMLImageElement(t){const e=t.naturalWidth,r=t.naturalHeight,i=document.createElement("canvas");return i.width=e,i.height=r,i.getContext("2d").drawImage(t,0,0,e,r,0,0,e,r),lt.fromHTMLCanvasElement(i)}static fromHTMLCanvasElement(t){const e=t.width,r=t.height,i=t.getContext("2d").getImageData(0,0,e,r);return lt.fromImageData(i)}static fromImageData(t){const e=t.width,r=t.height;return lt.fromUint8Array(t.data,e,r)}static fromUint8Array(t,e,r){switch(Object.prototype.toString.call(t)){case"[object Uint8ClampedArray]":case"[object Uint8Array]":break;default:t=new Uint8Array(t)}const i=new Uint32Array(t.buffer);return lt.fromUint32Array(i,e,r)}static fromUint32Array(t,e,r){const i=new lt;i._width=e,i._height=r;for(let e=0,r=t.length;e<r;e++)i._pointArray[e]=ht.createByUint32(0|t[e]);return i}static fromBuffer(t,e,r){const i=new Uint32Array(t.buffer,t.byteOffset,t.byteLength/Uint32Array.BYTES_PER_ELEMENT);return lt.fromUint32Array(i,e,r)}};function ft(t,e){const r=360/e;for(let i=1,n=r-r/2;i<e;i++,n+=r)if(t>=n&&t<n+r)return i;return 0}var ut=class{constructor(){f(this,"_pointContainer"),f(this,"_pointArray",[]),f(this,"_i32idx",{}),this._pointContainer=new lt,this._pointContainer.setHeight(1),this._pointArray=this._pointContainer.getPointArray()}add(t){this._pointArray.push(t),this._pointContainer.setWidth(this._pointArray.length)}has(t){for(let e=this._pointArray.length-1;e>=0;e--)if(t.uint32===this._pointArray[e].uint32)return!0;return!1}getNearestColor(t,e){return this._pointArray[0|this._getNearestIndex(t,e)]}getPointContainer(){return this._pointContainer}_nearestPointFromCache(t){return"number"==typeof this._i32idx[t]?this._i32idx[t]:-1}_getNearestIndex(t,e){let r=this._nearestPointFromCache(""+e.uint32);if(r>=0)return r;let i=Number.MAX_VALUE;r=0;for(let n=0,a=this._pointArray.length;n<a;n++){const a=this._pointArray[n],o=t.calculateRaw(e.r,e.g,e.b,e.a,a.r,a.g,a.b,a.a);o<i&&(i=o,r=n)}return this._i32idx[e.uint32]=r,r}sort(){this._i32idx={},this._pointArray.sort(((t,e)=>{const r=I(t.r,t.g,t.b),i=I(e.r,e.g,e.b),n=t.r===t.g&&t.g===t.b?0:1+ft(r.h,10),a=(e.r===e.g&&e.g===e.b?0:1+ft(i.h,10))-n;if(a)return-a;const o=t.getLuminosity(!0),s=e.getLuminosity(!0);if(s-o!=0)return s-o;const h=(100*i.s|0)-(100*r.s|0);return h?-h:0}))}},ct={};h(ct,{HueStatistics:()=>pt,Palette:()=>ut,Point:()=>ht,PointContainer:()=>lt,ProgressTracker:()=>gt,arithmetic:()=>w});var dt=class{constructor(){f(this,"num",0),f(this,"cols",[])}},pt=class{constructor(t,e){f(this,"_numGroups"),f(this,"_minCols"),f(this,"_stats"),f(this,"_groupsFull"),this._numGroups=t,this._minCols=e,this._stats=[];for(let e=0;e<=t;e++)this._stats[e]=new dt;this._groupsFull=0}check(t){this._groupsFull===this._numGroups+1&&(this.check=()=>{});const e=255&t,r=t>>>8&255,i=t>>>16&255,n=e===r&&r===i?0:1+ft(I(e,r,i).h,this._numGroups),a=this._stats[n],o=this._minCols;a.num++,a.num>o||(a.num===o&&this._groupsFull++,a.num<=o&&this._stats[n].cols.push(t))}injectIntoDictionary(t){for(let e=0;e<=this._numGroups;e++)this._stats[e].num<=this._minCols&&this._stats[e].cols.forEach((e=>{t[e]?t[e]++:t[e]=1}))}injectIntoArray(t){for(let e=0;e<=this._numGroups;e++)this._stats[e].num<=this._minCols&&this._stats[e].cols.forEach((e=>{-1===t.indexOf(e)&&t.push(e)}))}},mt=class{constructor(t,e){f(this,"progress"),f(this,"_step"),f(this,"_range"),f(this,"_last"),f(this,"_progressRange"),this._range=t,this._progressRange=e,this._step=Math.max(1,this._range/(mt.steps+1)|0),this._last=-this._step,this.progress=0}shouldNotify(t){return t-this._last>=this._step&&(this._last=t,this.progress=Math.min(this._progressRange*this._last/this._range,this._progressRange),!0)}},gt=mt;f(gt,"steps",100);var bt=class{constructor(t){f(this,"r"),f(this,"g"),f(this,"b"),f(this,"a"),this.r=this.g=this.b=this.a=t}toPoint(){return ht.createByRGBA(this.r>>3,this.g>>3,this.b>>3,this.a>>3)}subtract(t,e,r,i){this.r-=0|t,this.g-=0|e,this.b-=0|r,this.a-=0|i}},_t=class extends st{constructor(t,e=256){super(),f(this,"_pointArray"),f(this,"_networkSize"),f(this,"_network"),f(this,"_sampleFactor"),f(this,"_radPower"),f(this,"_freq"),f(this,"_bias"),f(this,"_distance"),this._distance=t,this._pointArray=[],this._sampleFactor=1,this._networkSize=e,this._distance.setWhitePoint(2040,2040,2040,2040)}sample(t){this._pointArray=this._pointArray.concat(t.getPointArray())}*quantize(){this._init(),yield*this._learn(),yield{palette:this._buildPalette(),progress:100}}_init(){this._freq=[],this._bias=[],this._radPower=[],this._network=[];for(let t=0;t<this._networkSize;t++)this._network[t]=new bt((t<<11)/this._networkSize|0),this._freq[t]=_t._initialBias/this._networkSize|0,this._bias[t]=0}*_learn(){let t=this._sampleFactor;const e=this._pointArray.length;e<_t._minpicturebytes&&(t=1);const r=30+(t-1)/3|0,i=e/t|0;let n,a=i/_t._nCycles|0,o=_t._initAlpha,s=(this._networkSize>>3)*_t._radiusBias,h=s>>_t._radiusBiasShift;h<=1&&(h=0);for(let t=0;t<h;t++)this._radPower[t]=o*((h*h-t*t)*_t._radBias/(h*h))>>>0;n=e<_t._minpicturebytes?1:e%_t._prime1!=0?_t._prime1:e%_t._prime2!=0?_t._prime2:e%_t._prime3!=0?_t._prime3:_t._prime4;const l=new gt(i,99);for(let t=0,f=0;t<i;){l.shouldNotify(t)&&(yield{progress:l.progress});const i=this._pointArray[f],u=i.b<<3,c=i.g<<3,d=i.r<<3,p=i.a<<3,m=this._contest(u,c,d,p);if(this._alterSingle(o,m,u,c,d,p),0!==h&&this._alterNeighbour(h,m,u,c,d,p),f+=n,f>=e&&(f-=e),t++,0===a&&(a=1),t%a==0){o-=o/r|0,s-=s/_t._radiusDecrease|0,h=s>>_t._radiusBiasShift,h<=1&&(h=0);for(let t=0;t<h;t++)this._radPower[t]=o*((h*h-t*t)*_t._radBias/(h*h))>>>0}}}_buildPalette(){const t=new ut;return this._network.forEach((e=>{t.add(e.toPoint())})),t.sort(),t}_alterNeighbour(t,e,r,i,n,a){let o=e-t;o<-1&&(o=-1);let s=e+t;s>this._networkSize&&(s=this._networkSize);let h=e+1,l=e-1,f=1;for(;h<s||l>o;){const t=this._radPower[f++]/_t._alphaRadBias;if(h<s){const e=this._network[h++];e.subtract(t*(e.r-n),t*(e.g-i),t*(e.b-r),t*(e.a-a))}if(l>o){const e=this._network[l--];e.subtract(t*(e.r-n),t*(e.g-i),t*(e.b-r),t*(e.a-a))}}}_alterSingle(t,e,r,i,n,a){t/=_t._initAlpha;const o=this._network[e];o.subtract(t*(o.r-n),t*(o.g-i),t*(o.b-r),t*(o.a-a))}_contest(t,e,r,i){let n=~(1<<31),a=n,o=-1,s=o;for(let h=0;h<this._networkSize;h++){const l=this._network[h],f=8160*this._distance.calculateNormalized(l,{r,g:e,b:t,a:i})|0;f<n&&(n=f,o=h);const u=f-(this._bias[h]>>_t._initialBiasShift-3);u<a&&(a=u,s=h);const c=this._freq[h]>>_t._betaShift;this._freq[h]-=c,this._bias[h]+=c<<_t._gammaShift}return this._freq[o]+=_t._beta,this._bias[o]-=_t._betaGamma,s}},yt=_t;f(yt,"_prime1",499),f(yt,"_prime2",491),f(yt,"_prime3",487),f(yt,"_prime4",503),f(yt,"_minpicturebytes",_t._prime4),f(yt,"_nCycles",100),f(yt,"_initialBiasShift",16),f(yt,"_initialBias",1<<_t._initialBiasShift),f(yt,"_gammaShift",10),f(yt,"_betaShift",10),f(yt,"_beta",_t._initialBias>>_t._betaShift),f(yt,"_betaGamma",_t._initialBias<<_t._gammaShift-_t._betaShift),f(yt,"_radiusBiasShift",6),f(yt,"_radiusBias",1<<_t._radiusBiasShift),f(yt,"_radiusDecrease",30),f(yt,"_alphaBiasShift",10),f(yt,"_initAlpha",1<<_t._alphaBiasShift),f(yt,"_radBiasShift",8),f(yt,"_radBias",1<<_t._radBiasShift),f(yt,"_alphaRadBiasShift",_t._alphaBiasShift+_t._radBiasShift),f(yt,"_alphaRadBias",1<<_t._alphaRadBiasShift);var wt=class{constructor(t){f(this,"r"),f(this,"g"),f(this,"b"),f(this,"a"),this.r=this.g=this.b=this.a=t}toPoint(){return ht.createByRGBA(this.r>>3,this.g>>3,this.b>>3,this.a>>3)}subtract(t,e,r,i){this.r-=t,this.g-=e,this.b-=r,this.a-=i}},vt=class extends st{constructor(t,e=256){super(),f(this,"_pointArray"),f(this,"_networkSize"),f(this,"_network"),f(this,"_sampleFactor"),f(this,"_radPower"),f(this,"_freq"),f(this,"_bias"),f(this,"_distance"),this._distance=t,this._pointArray=[],this._sampleFactor=1,this._networkSize=e,this._distance.setWhitePoint(2040,2040,2040,2040)}sample(t){this._pointArray=this._pointArray.concat(t.getPointArray())}*quantize(){this._init(),yield*this._learn(),yield{palette:this._buildPalette(),progress:100}}_init(){this._freq=[],this._bias=[],this._radPower=[],this._network=[];for(let t=0;t<this._networkSize;t++)this._network[t]=new wt((t<<11)/this._networkSize),this._freq[t]=vt._initialBias/this._networkSize,this._bias[t]=0}*_learn(){let t=this._sampleFactor;const e=this._pointArray.length;e<vt._minpicturebytes&&(t=1);const r=30+(t-1)/3,i=e/t;let n,a=i/vt._nCycles|0,o=vt._initAlpha,s=(this._networkSize>>3)*vt._radiusBias,h=s>>vt._radiusBiasShift;h<=1&&(h=0);for(let t=0;t<h;t++)this._radPower[t]=o*((h*h-t*t)*vt._radBias/(h*h));n=e<vt._minpicturebytes?1:e%vt._prime1!=0?vt._prime1:e%vt._prime2!=0?vt._prime2:e%vt._prime3!=0?vt._prime3:vt._prime4;const l=new gt(i,99);for(let t=0,f=0;t<i;){l.shouldNotify(t)&&(yield{progress:l.progress});const i=this._pointArray[f],u=i.b<<3,c=i.g<<3,d=i.r<<3,p=i.a<<3,m=this._contest(u,c,d,p);if(this._alterSingle(o,m,u,c,d,p),0!==h&&this._alterNeighbour(h,m,u,c,d,p),f+=n,f>=e&&(f-=e),t++,0===a&&(a=1),t%a==0){o-=o/r,s-=s/vt._radiusDecrease,h=s>>vt._radiusBiasShift,h<=1&&(h=0);for(let t=0;t<h;t++)this._radPower[t]=o*((h*h-t*t)*vt._radBias/(h*h))}}}_buildPalette(){const t=new ut;return this._network.forEach((e=>{t.add(e.toPoint())})),t.sort(),t}_alterNeighbour(t,e,r,i,n,a){let o=e-t;o<-1&&(o=-1);let s=e+t;s>this._networkSize&&(s=this._networkSize);let h=e+1,l=e-1,f=1;for(;h<s||l>o;){const t=this._radPower[f++]/vt._alphaRadBias;if(h<s){const e=this._network[h++];e.subtract(t*(e.r-n),t*(e.g-i),t*(e.b-r),t*(e.a-a))}if(l>o){const e=this._network[l--];e.subtract(t*(e.r-n),t*(e.g-i),t*(e.b-r),t*(e.a-a))}}}_alterSingle(t,e,r,i,n,a){t/=vt._initAlpha;const o=this._network[e];o.subtract(t*(o.r-n),t*(o.g-i),t*(o.b-r),t*(o.a-a))}_contest(t,e,r,i){let n=~(1<<31),a=n,o=-1,s=o;for(let h=0;h<this._networkSize;h++){const l=this._network[h],f=8160*this._distance.calculateNormalized(l,{r,g:e,b:t,a:i});f<n&&(n=f,o=h);const u=f-(this._bias[h]>>vt._initialBiasShift-3);u<a&&(a=u,s=h);const c=this._freq[h]>>vt._betaShift;this._freq[h]-=c,this._bias[h]+=c<<vt._gammaShift}return this._freq[o]+=vt._beta,this._bias[o]-=vt._betaGamma,s}},xt=vt;f(xt,"_prime1",499),f(xt,"_prime2",491),f(xt,"_prime3",487),f(xt,"_prime4",503),f(xt,"_minpicturebytes",vt._prime4),f(xt,"_nCycles",100),f(xt,"_initialBiasShift",16),f(xt,"_initialBias",1<<vt._initialBiasShift),f(xt,"_gammaShift",10),f(xt,"_betaShift",10),f(xt,"_beta",vt._initialBias>>vt._betaShift),f(xt,"_betaGamma",vt._initialBias<<vt._gammaShift-vt._betaShift),f(xt,"_radiusBiasShift",6),f(xt,"_radiusBias",1<<vt._radiusBiasShift),f(xt,"_radiusDecrease",30),f(xt,"_alphaBiasShift",10),f(xt,"_initAlpha",1<<vt._alphaBiasShift),f(xt,"_radBiasShift",8),f(xt,"_radBias",1<<vt._radBiasShift),f(xt,"_alphaRadBiasShift",vt._alphaBiasShift+vt._radBiasShift),f(xt,"_alphaRadBias",1<<vt._alphaRadBiasShift);var Et=class{constructor(t,e){f(this,"_method"),f(this,"_hueStats"),f(this,"_histogram"),f(this,"_initColors"),f(this,"_minHueCols"),this._method=t,this._minHueCols=e<<2,this._initColors=e<<2,this._hueStats=new pt(Et._hueGroups,this._minHueCols),this._histogram=Object.create(null)}sample(t){switch(this._method){case 1:this._colorStats1D(t);break;case 2:this._colorStats2D(t)}}getImportanceSortedColorsIDXI32(){const t=A(Object.keys(this._histogram),((t,e)=>this._histogram[e]-this._histogram[t]));if(0===t.length)return[];let e;switch(this._method){case 1:const r=Math.min(t.length,this._initColors),i=t[r-1],n=this._histogram[i];e=t.slice(0,r);let a=r;const o=t.length;for(;a<o&&this._histogram[t[a]]===n;)e.push(t[a++]);this._hueStats.injectIntoArray(e);break;case 2:e=t;break;default:throw new Error("Incorrect method")}return e.map((t=>+t))}_colorStats1D(t){const e=this._histogram,r=t.getPointArray(),i=r.length;for(let t=0;t<i;t++){const i=r[t].uint32;this._hueStats.check(i),i in e?e[i]++:e[i]=1}}_colorStats2D(t){const e=t.getWidth(),r=t.getHeight(),i=t.getPointArray(),n=Et._boxSize[0],a=Et._boxSize[1],o=n*a,s=this._makeBoxes(e,r,n,a),h=this._histogram;s.forEach((t=>{let r=Math.round(t.w*t.h/o)*Et._boxPixels;r<2&&(r=2);const n={};this._iterateBox(t,e,(t=>{const e=i[t].uint32;this._hueStats.check(e),e in h?h[e]++:e in n?++n[e]>=r&&(h[e]=n[e]):n[e]=1}))})),this._hueStats.injectIntoDictionary(h)}_iterateBox(t,e,r){const i=t,n=i.y*e+i.x,a=(i.y+i.h-1)*e+(i.x+i.w-1),o=e-i.w+1;let s=0,h=n;do{r.call(this,h),h+=++s%i.w==0?o:1}while(h<=a)}_makeBoxes(t,e,r,i){const n=t%r,a=e%i,o=t-n,s=e-a,h=[];for(let l=0;l<e;l+=i)for(let e=0;e<t;e+=r)h.push({x:e,y:l,w:e===o?n:r,h:l===s?a:i});return h}},kt=Et;f(kt,"_boxSize",[64,64]),f(kt,"_boxPixels",2),f(kt,"_hueGroups",10);var St=class{constructor(t,e,r){f(this,"index"),f(this,"color"),f(this,"distance"),this.index=t,this.color=e,this.distance=r}},Mt=class extends st{constructor(t,e=256,r=2){super(),f(this,"_colors"),f(this,"_initialDistance"),f(this,"_distanceIncrement"),f(this,"_histogram"),f(this,"_distance"),this._distance=t,this._colors=e,this._histogram=new kt(r,e),this._initialDistance=.01,this._distanceIncrement=.005}sample(t){this._histogram.sample(t)}*quantize(){const t=this._histogram.getImportanceSortedColorsIDXI32();if(0===t.length)throw new Error("No colors in image");yield*this._buildPalette(t)}*_buildPalette(t){const e=new ut,r=e.getPointContainer().getPointArray(),i=new Array(t.length);for(let e=0;e<t.length;e++)r.push(ht.createByUint32(t[e])),i[e]=1;const n=r.length,a=[];let o=n,s=this._initialDistance;const h=new gt(o-this._colors,99);for(;o>this._colors;){a.length=0;for(let t=0;t<n;t++){if(h.shouldNotify(n-o)&&(yield{progress:h.progress}),0===i[t])continue;const e=r[t];for(let h=t+1;h<n;h++){if(0===i[h])continue;const t=r[h],n=this._distance.calculateNormalized(e,t);n<s&&(a.push(new St(h,t,n)),i[h]=0,o--)}}s+=o>3*this._colors?this._initialDistance:this._distanceIncrement}if(o<this._colors){A(a,((t,e)=>e.distance-t.distance));let t=0;for(;o<this._colors&&t<a.length;)i[a[t].index]=1,o++,t++}let l=r.length;for(let t=l-1;t>=0;t--)0===i[t]&&(t!==l-1&&(r[t]=r[l-1]),--l);r.length=l,e.sort(),yield{palette:e,progress:100}}};function At(t){const e=[];for(let r=0;r<t;r++)e[r]=0;return e}function It(t,e,r,i){const n=new Array(t);for(let a=0;a<t;a++){n[a]=new Array(e);for(let t=0;t<e;t++){n[a][t]=new Array(r);for(let e=0;e<r;e++){n[a][t][e]=new Array(i);for(let r=0;r<i;r++)n[a][t][e][r]=0}}}return n}function Bt(t,e,r){const i=new Array(t);for(let n=0;n<t;n++){i[n]=new Array(e);for(let t=0;t<e;t++){i[n][t]=new Array(r);for(let e=0;e<r;e++)i[n][t][e]=0}}return i}function Tt(t,e,r,i,n){for(let a=0;a<e;a++){t[a]=[];for(let e=0;e<r;e++){t[a][e]=[];for(let r=0;r<i;r++)t[a][e][r]=n}}}function Rt(t,e,r){for(let i=0;i<e;i++)t[i]=r}var Pt=class{constructor(){f(this,"redMinimum"),f(this,"redMaximum"),f(this,"greenMinimum"),f(this,"greenMaximum"),f(this,"blueMinimum"),f(this,"blueMaximum"),f(this,"volume"),f(this,"alphaMinimum"),f(this,"alphaMaximum")}},Ot=class extends st{constructor(t,e=256,r=5){super(),f(this,"_reds"),f(this,"_greens"),f(this,"_blues"),f(this,"_alphas"),f(this,"_sums"),f(this,"_weights"),f(this,"_momentsRed"),f(this,"_momentsGreen"),f(this,"_momentsBlue"),f(this,"_momentsAlpha"),f(this,"_moments"),f(this,"_table"),f(this,"_pixels"),f(this,"_cubes"),f(this,"_colors"),f(this,"_significantBitsPerChannel"),f(this,"_maxSideIndex"),f(this,"_alphaMaxSideIndex"),f(this,"_sideSize"),f(this,"_alphaSideSize"),f(this,"_distance"),this._distance=t,this._setQuality(r),this._initialize(e)}sample(t){const e=t.getPointArray();for(let t=0,r=e.length;t<r;t++)this._addColor(e[t]);this._pixels=this._pixels.concat(e)}*quantize(){yield*this._preparePalette();const t=new ut;for(let e=0;e<this._colors;e++)if(this._sums[e]>0){const r=this._sums[e],i=this._reds[e]/r,n=this._greens[e]/r,a=this._blues[e]/r,o=this._alphas[e]/r,s=ht.createByRGBA(0|i,0|n,0|a,0|o);t.add(s)}t.sort(),yield{palette:t,progress:100}}*_preparePalette(){yield*this._calculateMoments();let t=0;const e=At(this._colors);for(let r=1;r<this._colors;++r){this._cut(this._cubes[t],this._cubes[r])?(e[t]=this._cubes[t].volume>1?this._calculateVariance(this._cubes[t]):0,e[r]=this._cubes[r].volume>1?this._calculateVariance(this._cubes[r]):0):(e[t]=0,r--),t=0;let i=e[0];for(let n=1;n<=r;++n)e[n]>i&&(i=e[n],t=n);if(i<=0){this._colors=r+1;break}}const r=[],i=[],n=[],a=[];for(let t=0;t<this._colors;++t){const e=Ot._volume(this._cubes[t],this._weights);e>0?(r[t]=Ot._volume(this._cubes[t],this._momentsRed)/e|0,i[t]=Ot._volume(this._cubes[t],this._momentsGreen)/e|0,n[t]=Ot._volume(this._cubes[t],this._momentsBlue)/e|0,a[t]=Ot._volume(this._cubes[t],this._momentsAlpha)/e|0):(r[t]=0,i[t]=0,n[t]=0,a[t]=0)}this._reds=At(this._colors+1),this._greens=At(this._colors+1),this._blues=At(this._colors+1),this._alphas=At(this._colors+1),this._sums=At(this._colors+1);for(let t=0,e=this._pixels.length;t<e;t++){const e=this._pixels[t];let o=-1,s=Number.MAX_VALUE;for(let t=0;t<this._colors;t++){const h=r[t],l=i[t],f=n[t],u=a[t],c=this._distance.calculateRaw(h,l,f,u,e.r,e.g,e.b,e.a);c<s&&(s=c,o=t)}this._reds[o]+=e.r,this._greens[o]+=e.g,this._blues[o]+=e.b,this._alphas[o]+=e.a,this._sums[o]++}}_addColor(t){const e=8-this._significantBitsPerChannel,r=1+(t.r>>e),i=1+(t.g>>e),n=1+(t.b>>e),a=1+(t.a>>e);this._weights[a][r][i][n]++,this._momentsRed[a][r][i][n]+=t.r,this._momentsGreen[a][r][i][n]+=t.g,this._momentsBlue[a][r][i][n]+=t.b,this._momentsAlpha[a][r][i][n]+=t.a,this._moments[a][r][i][n]+=this._table[t.r]+this._table[t.g]+this._table[t.b]+this._table[t.a]}*_calculateMoments(){const t=[],e=[],r=[],i=[],n=[],a=[],o=Bt(this._sideSize,this._sideSize,this._sideSize),s=Bt(this._sideSize,this._sideSize,this._sideSize),h=Bt(this._sideSize,this._sideSize,this._sideSize),l=Bt(this._sideSize,this._sideSize,this._sideSize),f=Bt(this._sideSize,this._sideSize,this._sideSize),u=Bt(this._sideSize,this._sideSize,this._sideSize);let c=0;const d=new gt(this._alphaMaxSideIndex*this._maxSideIndex,99);for(let p=1;p<=this._alphaMaxSideIndex;++p){Tt(o,this._sideSize,this._sideSize,this._sideSize,0),Tt(s,this._sideSize,this._sideSize,this._sideSize,0),Tt(h,this._sideSize,this._sideSize,this._sideSize,0),Tt(l,this._sideSize,this._sideSize,this._sideSize,0),Tt(f,this._sideSize,this._sideSize,this._sideSize,0),Tt(u,this._sideSize,this._sideSize,this._sideSize,0);for(let m=1;m<=this._maxSideIndex;++m,++c){d.shouldNotify(c)&&(yield{progress:d.progress}),Rt(t,this._sideSize,0),Rt(e,this._sideSize,0),Rt(r,this._sideSize,0),Rt(i,this._sideSize,0),Rt(n,this._sideSize,0),Rt(a,this._sideSize,0);for(let c=1;c<=this._maxSideIndex;++c){let d=0,g=0,b=0,_=0,y=0,w=0;for(let v=1;v<=this._maxSideIndex;++v)d+=this._weights[p][m][c][v],g+=this._momentsRed[p][m][c][v],b+=this._momentsGreen[p][m][c][v],_+=this._momentsBlue[p][m][c][v],y+=this._momentsAlpha[p][m][c][v],w+=this._moments[p][m][c][v],t[v]+=d,e[v]+=g,r[v]+=b,i[v]+=_,n[v]+=y,a[v]+=w,o[m][c][v]=o[m-1][c][v]+t[v],s[m][c][v]=s[m-1][c][v]+e[v],h[m][c][v]=h[m-1][c][v]+r[v],l[m][c][v]=l[m-1][c][v]+i[v],f[m][c][v]=f[m-1][c][v]+n[v],u[m][c][v]=u[m-1][c][v]+a[v],this._weights[p][m][c][v]=this._weights[p-1][m][c][v]+o[m][c][v],this._momentsRed[p][m][c][v]=this._momentsRed[p-1][m][c][v]+s[m][c][v],this._momentsGreen[p][m][c][v]=this._momentsGreen[p-1][m][c][v]+h[m][c][v],this._momentsBlue[p][m][c][v]=this._momentsBlue[p-1][m][c][v]+l[m][c][v],this._momentsAlpha[p][m][c][v]=this._momentsAlpha[p-1][m][c][v]+f[m][c][v],this._moments[p][m][c][v]=this._moments[p-1][m][c][v]+u[m][c][v]}}}}static _volumeFloat(t,e){return e[t.alphaMaximum][t.redMaximum][t.greenMaximum][t.blueMaximum]-e[t.alphaMaximum][t.redMaximum][t.greenMinimum][t.blueMaximum]-e[t.alphaMaximum][t.redMinimum][t.greenMaximum][t.blueMaximum]+e[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMaximum]-e[t.alphaMinimum][t.redMaximum][t.greenMaximum][t.blueMaximum]+e[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMaximum]+e[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMaximum]-e[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMaximum]-(e[t.alphaMaximum][t.redMaximum][t.greenMaximum][t.blueMinimum]-e[t.alphaMinimum][t.redMaximum][t.greenMaximum][t.blueMinimum]-e[t.alphaMaximum][t.redMaximum][t.greenMinimum][t.blueMinimum]+e[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMinimum]-e[t.alphaMaximum][t.redMinimum][t.greenMaximum][t.blueMinimum]+e[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMinimum]+e[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMinimum]-e[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMinimum])}static _volume(t,e){return 0|Ot._volumeFloat(t,e)}static _top(t,e,r,i){let n;switch(e){case Ot._alpha:n=i[r][t.redMaximum][t.greenMaximum][t.blueMaximum]-i[r][t.redMaximum][t.greenMinimum][t.blueMaximum]-i[r][t.redMinimum][t.greenMaximum][t.blueMaximum]+i[r][t.redMinimum][t.greenMinimum][t.blueMaximum]-(i[r][t.redMaximum][t.greenMaximum][t.blueMinimum]-i[r][t.redMaximum][t.greenMinimum][t.blueMinimum]-i[r][t.redMinimum][t.greenMaximum][t.blueMinimum]+i[r][t.redMinimum][t.greenMinimum][t.blueMinimum]);break;case Ot._red:n=i[t.alphaMaximum][r][t.greenMaximum][t.blueMaximum]-i[t.alphaMaximum][r][t.greenMinimum][t.blueMaximum]-i[t.alphaMinimum][r][t.greenMaximum][t.blueMaximum]+i[t.alphaMinimum][r][t.greenMinimum][t.blueMaximum]-(i[t.alphaMaximum][r][t.greenMaximum][t.blueMinimum]-i[t.alphaMaximum][r][t.greenMinimum][t.blueMinimum]-i[t.alphaMinimum][r][t.greenMaximum][t.blueMinimum]+i[t.alphaMinimum][r][t.greenMinimum][t.blueMinimum]);break;case Ot._green:n=i[t.alphaMaximum][t.redMaximum][r][t.blueMaximum]-i[t.alphaMaximum][t.redMinimum][r][t.blueMaximum]-i[t.alphaMinimum][t.redMaximum][r][t.blueMaximum]+i[t.alphaMinimum][t.redMinimum][r][t.blueMaximum]-(i[t.alphaMaximum][t.redMaximum][r][t.blueMinimum]-i[t.alphaMaximum][t.redMinimum][r][t.blueMinimum]-i[t.alphaMinimum][t.redMaximum][r][t.blueMinimum]+i[t.alphaMinimum][t.redMinimum][r][t.blueMinimum]);break;case Ot._blue:n=i[t.alphaMaximum][t.redMaximum][t.greenMaximum][r]-i[t.alphaMaximum][t.redMaximum][t.greenMinimum][r]-i[t.alphaMaximum][t.redMinimum][t.greenMaximum][r]+i[t.alphaMaximum][t.redMinimum][t.greenMinimum][r]-(i[t.alphaMinimum][t.redMaximum][t.greenMaximum][r]-i[t.alphaMinimum][t.redMaximum][t.greenMinimum][r]-i[t.alphaMinimum][t.redMinimum][t.greenMaximum][r]+i[t.alphaMinimum][t.redMinimum][t.greenMinimum][r]);break;default:throw new Error("impossible")}return 0|n}static _bottom(t,e,r){switch(e){case Ot._alpha:return-r[t.alphaMinimum][t.redMaximum][t.greenMaximum][t.blueMaximum]+r[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMaximum]+r[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMaximum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMaximum]-(-r[t.alphaMinimum][t.redMaximum][t.greenMaximum][t.blueMinimum]+r[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMinimum]+r[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMinimum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMinimum]);case Ot._red:return-r[t.alphaMaximum][t.redMinimum][t.greenMaximum][t.blueMaximum]+r[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMaximum]+r[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMaximum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMaximum]-(-r[t.alphaMaximum][t.redMinimum][t.greenMaximum][t.blueMinimum]+r[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMinimum]+r[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMinimum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMinimum]);case Ot._green:return-r[t.alphaMaximum][t.redMaximum][t.greenMinimum][t.blueMaximum]+r[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMaximum]+r[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMaximum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMaximum]-(-r[t.alphaMaximum][t.redMaximum][t.greenMinimum][t.blueMinimum]+r[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMinimum]+r[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMinimum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMinimum]);case Ot._blue:return-r[t.alphaMaximum][t.redMaximum][t.greenMaximum][t.blueMinimum]+r[t.alphaMaximum][t.redMaximum][t.greenMinimum][t.blueMinimum]+r[t.alphaMaximum][t.redMinimum][t.greenMaximum][t.blueMinimum]-r[t.alphaMaximum][t.redMinimum][t.greenMinimum][t.blueMinimum]-(-r[t.alphaMinimum][t.redMaximum][t.greenMaximum][t.blueMinimum]+r[t.alphaMinimum][t.redMaximum][t.greenMinimum][t.blueMinimum]+r[t.alphaMinimum][t.redMinimum][t.greenMaximum][t.blueMinimum]-r[t.alphaMinimum][t.redMinimum][t.greenMinimum][t.blueMinimum]);default:return 0}}_calculateVariance(t){const e=Ot._volume(t,this._momentsRed),r=Ot._volume(t,this._momentsGreen),i=Ot._volume(t,this._momentsBlue),n=Ot._volume(t,this._momentsAlpha);return Ot._volumeFloat(t,this._moments)-(e*e+r*r+i*i+n*n)/Ot._volume(t,this._weights)}_maximize(t,e,r,i,n,a,o,s,h){const l=0|Ot._bottom(t,e,this._momentsRed),f=0|Ot._bottom(t,e,this._momentsGreen),u=0|Ot._bottom(t,e,this._momentsBlue),c=0|Ot._bottom(t,e,this._momentsAlpha),d=0|Ot._bottom(t,e,this._weights);let p=0,m=-1;for(let g=r;g<i;++g){let r=l+Ot._top(t,e,g,this._momentsRed),i=f+Ot._top(t,e,g,this._momentsGreen),b=u+Ot._top(t,e,g,this._momentsBlue),_=c+Ot._top(t,e,g,this._momentsAlpha),y=d+Ot._top(t,e,g,this._weights);if(0!==y){let t=r*r+i*i+b*b+_*_,e=t/y;r=n-r,i=a-i,b=o-b,_=s-_,y=h-y,0!==y&&(t=r*r+i*i+b*b+_*_,e+=t/y,e>p&&(p=e,m=g))}}return{max:p,position:m}}_cut(t,e){let r;const i=Ot._volume(t,this._momentsRed),n=Ot._volume(t,this._momentsGreen),a=Ot._volume(t,this._momentsBlue),o=Ot._volume(t,this._momentsAlpha),s=Ot._volume(t,this._weights),h=this._maximize(t,Ot._red,t.redMinimum+1,t.redMaximum,i,n,a,o,s),l=this._maximize(t,Ot._green,t.greenMinimum+1,t.greenMaximum,i,n,a,o,s),f=this._maximize(t,Ot._blue,t.blueMinimum+1,t.blueMaximum,i,n,a,o,s),u=this._maximize(t,Ot._alpha,t.alphaMinimum+1,t.alphaMaximum,i,n,a,o,s);if(u.max>=h.max&&u.max>=l.max&&u.max>=f.max){if(r=Ot._alpha,u.position<0)return!1}else r=h.max>=u.max&&h.max>=l.max&&h.max>=f.max?Ot._red:l.max>=u.max&&l.max>=h.max&&l.max>=f.max?Ot._green:Ot._blue;switch(e.redMaximum=t.redMaximum,e.greenMaximum=t.greenMaximum,e.blueMaximum=t.blueMaximum,e.alphaMaximum=t.alphaMaximum,r){case Ot._red:e.redMinimum=t.redMaximum=h.position,e.greenMinimum=t.greenMinimum,e.blueMinimum=t.blueMinimum,e.alphaMinimum=t.alphaMinimum;break;case Ot._green:e.greenMinimum=t.greenMaximum=l.position,e.redMinimum=t.redMinimum,e.blueMinimum=t.blueMinimum,e.alphaMinimum=t.alphaMinimum;break;case Ot._blue:e.blueMinimum=t.blueMaximum=f.position,e.redMinimum=t.redMinimum,e.greenMinimum=t.greenMinimum,e.alphaMinimum=t.alphaMinimum;break;case Ot._alpha:e.alphaMinimum=t.alphaMaximum=u.position,e.blueMinimum=t.blueMinimum,e.redMinimum=t.redMinimum,e.greenMinimum=t.greenMinimum}return t.volume=(t.redMaximum-t.redMinimum)*(t.greenMaximum-t.greenMinimum)*(t.blueMaximum-t.blueMinimum)*(t.alphaMaximum-t.alphaMinimum),e.volume=(e.redMaximum-e.redMinimum)*(e.greenMaximum-e.greenMinimum)*(e.blueMaximum-e.blueMinimum)*(e.alphaMaximum-e.alphaMinimum),!0}_initialize(t){this._colors=t,this._cubes=[];for(let e=0;e<t;e++)this._cubes[e]=new Pt;this._cubes[0].redMinimum=0,this._cubes[0].greenMinimum=0,this._cubes[0].blueMinimum=0,this._cubes[0].alphaMinimum=0,this._cubes[0].redMaximum=this._maxSideIndex,this._cubes[0].greenMaximum=this._maxSideIndex,this._cubes[0].blueMaximum=this._maxSideIndex,this._cubes[0].alphaMaximum=this._alphaMaxSideIndex,this._weights=It(this._alphaSideSize,this._sideSize,this._sideSize,this._sideSize),this._momentsRed=It(this._alphaSideSize,this._sideSize,this._sideSize,this._sideSize),this._momentsGreen=It(this._alphaSideSize,this._sideSize,this._sideSize,this._sideSize),this._momentsBlue=It(this._alphaSideSize,this._sideSize,this._sideSize,this._sideSize),this._momentsAlpha=It(this._alphaSideSize,this._sideSize,this._sideSize,this._sideSize),this._moments=It(this._alphaSideSize,this._sideSize,this._sideSize,this._sideSize),this._table=[];for(let t=0;t<256;++t)this._table[t]=t*t;this._pixels=[]}_setQuality(t=5){this._significantBitsPerChannel=t,this._maxSideIndex=1<<this._significantBitsPerChannel,this._alphaMaxSideIndex=this._maxSideIndex,this._sideSize=this._maxSideIndex+1,this._alphaSideSize=this._alphaMaxSideIndex+1}},Lt=Ot;f(Lt,"_alpha",3),f(Lt,"_red",2),f(Lt,"_green",1),f(Lt,"_blue",0);var Ct={};h(Ct,{AbstractImageQuantizer:()=>Ut,ErrorDiffusionArray:()=>Nt,ErrorDiffusionArrayKernel:()=>Dt,ErrorDiffusionRiemersma:()=>Ht,NearestColor:()=>zt});var Ut=class{quantizeSync(t,e){for(const r of this.quantize(t,e))if(r.pointContainer)return r.pointContainer;throw new Error("unreachable")}},zt=class extends Ut{constructor(t){super(),f(this,"_distance"),this._distance=t}*quantize(t,e){const r=t.getPointArray(),i=t.getWidth(),n=t.getHeight(),a=new gt(n,99);for(let t=0;t<n;t++){a.shouldNotify(t)&&(yield{progress:a.progress});for(let n=0,a=t*i;n<i;n++,a++){const t=r[a];t.from(e.getNearestColor(this._distance,t))}}yield{pointContainer:t,progress:100}}},Dt=(t=>(t[t.FloydSteinberg=0]="FloydSteinberg",t[t.FalseFloydSteinberg=1]="FalseFloydSteinberg",t[t.Stucki=2]="Stucki",t[t.Atkinson=3]="Atkinson",t[t.Jarvis=4]="Jarvis",t[t.Burkes=5]="Burkes",t[t.Sierra=6]="Sierra",t[t.TwoSierra=7]="TwoSierra",t[t.SierraLite=8]="SierraLite",t))(Dt||{}),Nt=class extends Ut{constructor(t,e,r=!0,i=0,n=!1){super(),f(this,"_minColorDistance"),f(this,"_serpentine"),f(this,"_kernel"),f(this,"_calculateErrorLikeGIMP"),f(this,"_distance"),this._setKernel(e),this._distance=t,this._minColorDistance=i,this._serpentine=r,this._calculateErrorLikeGIMP=n}*quantize(t,e){const r=t.getPointArray(),i=new ht,n=t.getWidth(),a=t.getHeight(),o=[];let s=1,h=1;for(const t of this._kernel){const e=t[2]+1;h<e&&(h=e)}for(let t=0;t<h;t++)this._fillErrorLine(o[t]=[],n);const l=new gt(a,99);for(let t=0;t<a;t++){l.shouldNotify(t)&&(yield{progress:l.progress}),this._serpentine&&(s*=-1);const h=t*n,f=1===s?0:n-1,u=1===s?n:-1;this._fillErrorLine(o[0],n),o.push(o.shift());const c=o[0];for(let l=f,d=h+f;l!==u;l+=s,d+=s){const h=r[d],f=c[l];i.from(h);const u=ht.createByRGBA(S(h.r+f[0]),S(h.g+f[1]),S(h.b+f[2]),S(h.a+f[3])),p=e.getNearestColor(this._distance,u);if(h.from(p),this._minColorDistance&&this._distance.calculateNormalized(i,p)<this._minColorDistance)continue;let m,g,b,_;this._calculateErrorLikeGIMP?(m=u.r-p.r,g=u.g-p.g,b=u.b-p.b,_=u.a-p.a):(m=i.r-p.r,g=i.g-p.g,b=i.b-p.b,_=i.a-p.a);const y=1===s?0:this._kernel.length-1,w=1===s?this._kernel.length:-1;for(let e=y;e!==w;e+=s){const r=this._kernel[e][1]*s,i=this._kernel[e][2];if(r+l>=0&&r+l<n&&i+t>=0&&i+t<a){const t=this._kernel[e][0],n=o[i][r+l];n[0]+=m*t,n[1]+=g*t,n[2]+=b*t,n[3]+=_*t}}}}yield{pointContainer:t,progress:100}}_fillErrorLine(t,e){t.length>e&&(t.length=e);const r=t.length;for(let e=0;e<r;e++){const r=t[e];r[0]=r[1]=r[2]=r[3]=0}for(let i=r;i<e;i++)t[i]=[0,0,0,0]}_setKernel(t){switch(t){case 0:this._kernel=[[7/16,1,0],[3/16,-1,1],[5/16,0,1],[1/16,1,1]];break;case 1:this._kernel=[[3/8,1,0],[3/8,0,1],[2/8,1,1]];break;case 2:this._kernel=[[8/42,1,0],[4/42,2,0],[2/42,-2,1],[4/42,-1,1],[8/42,0,1],[4/42,1,1],[2/42,2,1],[1/42,-2,2],[2/42,-1,2],[4/42,0,2],[2/42,1,2],[1/42,2,2]];break;case 3:this._kernel=[[1/8,1,0],[1/8,2,0],[1/8,-1,1],[1/8,0,1],[1/8,1,1],[1/8,0,2]];break;case 4:this._kernel=[[7/48,1,0],[5/48,2,0],[3/48,-2,1],[5/48,-1,1],[7/48,0,1],[5/48,1,1],[3/48,2,1],[1/48,-2,2],[3/48,-1,2],[5/48,0,2],[3/48,1,2],[1/48,2,2]];break;case 5:this._kernel=[[.25,1,0],[4/32,2,0],[2/32,-2,1],[4/32,-1,1],[.25,0,1],[4/32,1,1],[2/32,2,1]];break;case 6:this._kernel=[[5/32,1,0],[3/32,2,0],[2/32,-2,1],[4/32,-1,1],[5/32,0,1],[4/32,1,1],[2/32,2,1],[2/32,-1,2],[3/32,0,2],[2/32,1,2]];break;case 7:this._kernel=[[.25,1,0],[3/16,2,0],[1/16,-2,1],[2/16,-1,1],[3/16,0,1],[2/16,1,1],[1/16,2,1]];break;case 8:this._kernel=[[.5,1,0],[1/4,-1,1],[1/4,0,1]];break;default:throw new Error(`ErrorDiffusionArray: unknown kernel = ${t}`)}}};function*Ft(t,e,r){const i=Math.max(t,e),n={width:t,height:e,level:Math.floor(Math.log(i)/Math.log(2)+1),callback:r,tracker:new gt(t*e,99),index:0,x:0,y:0};yield*jt(n,1),Gt(n,0)}function*jt(t,e){if(!(t.level<1)){switch(t.tracker.shouldNotify(t.index)&&(yield{progress:t.tracker.progress}),t.level--,e){case 2:yield*jt(t,1),Gt(t,3),yield*jt(t,2),Gt(t,4),yield*jt(t,2),Gt(t,2),yield*jt(t,4);break;case 3:yield*jt(t,4),Gt(t,2),yield*jt(t,3),Gt(t,1),yield*jt(t,3),Gt(t,3),yield*jt(t,1);break;case 1:yield*jt(t,2),Gt(t,4),yield*jt(t,1),Gt(t,3),yield*jt(t,1),Gt(t,1),yield*jt(t,3);break;case 4:yield*jt(t,3),Gt(t,1),yield*jt(t,4),Gt(t,2),yield*jt(t,4),Gt(t,4),yield*jt(t,2)}t.level++}}function Gt(t,e){switch(t.x>=0&&t.x<t.width&&t.y>=0&&t.y<t.height&&(t.callback(t.x,t.y),t.index++),e){case 2:t.x--;break;case 3:t.x++;break;case 1:t.y--;break;case 4:t.y++}}var Ht=class extends Ut{constructor(t,e=16,r=1){super(),f(this,"_distance"),f(this,"_weights"),f(this,"_errorQueueSize"),this._distance=t,this._errorQueueSize=e,this._weights=Ht._createWeights(r,e)}*quantize(t,e){const r=t.getPointArray(),i=t.getWidth(),n=t.getHeight(),a=[];let o=0;for(let t=0;t<this._errorQueueSize;t++)a[t]={r:0,g:0,b:0,a:0};yield*Ft(i,n,((t,n)=>{const s=r[t+n*i];let{r:h,g:l,b:f,a:u}=s;for(let t=0;t<this._errorQueueSize;t++){const e=this._weights[t],r=a[(t+o)%this._errorQueueSize];h+=r.r*e,l+=r.g*e,f+=r.b*e,u+=r.a*e}const c=ht.createByRGBA(S(h),S(l),S(f),S(u)),d=e.getNearestColor(this._distance,c);o=(o+1)%this._errorQueueSize;const p=(o+this._errorQueueSize-1)%this._errorQueueSize;a[p].r=s.r-d.r,a[p].g=s.g-d.g,a[p].b=s.b-d.b,a[p].a=s.a-d.a,s.from(d)})),yield{pointContainer:t,progress:100}}static _createWeights(t,e){const r=[],i=Math.exp(Math.log(e)/(e-1));for(let n=0,a=1;n<e;n++)r[n]=(a+.5|0)/e*t,a*=i;return r}},Wt={};h(Wt,{ssim:()=>Yt});var qt=.01,Zt=.03;function Yt(t,e){if(t.getHeight()!==e.getHeight()||t.getWidth()!==e.getWidth())throw new Error("Images have different sizes!");const r=(255*qt)**2,i=(255*Zt)**2;let n=0,a=0;return function(t,e,r){const i=t.getWidth(),n=t.getHeight();for(let a=0;a<n;a+=8)for(let o=0;o<i;o+=8){const s=Math.min(8,i-o),h=Math.min(8,n-a),l=Vt(t,o,a,s,h),f=Vt(e,o,a,s,h);r(l,f,Xt(l),Xt(f))}}(t,e,((t,e,o,s)=>{let h=0,l=0,f=0;for(let r=0;r<t.length;r++)l+=(t[r]-o)**2,f+=(e[r]-s)**2,h+=(t[r]-o)*(e[r]-s);const u=t.length-1;l/=u,f/=u,h/=u,a+=(2*o*s+r)*(2*h+i)/((o**2+s**2+r)*(l+f+i)),n++})),a/n}function Vt(t,e,r,i,n){const a=t.getPointArray(),o=[];let s=0;for(let h=r;h<r+n;h++){const r=h*t.getWidth();for(let t=e;t<e+i;t++){const e=a[r+t];o[s]=.2126*e.r+.7152*e.g+.0722*e.b,s++}}return o}function Xt(t){let e=0;for(const r of t)e+=r;return e/t.length}var Jt="function"==typeof setImmediate?setImmediate:void 0!==i&&"function"==typeof(null==i?void 0:i.nextTick)?t=>i.nextTick(t):t=>setTimeout(t,0);function Qt(t,{colorDistanceFormula:e,paletteQuantization:r,colors:i}={}){const n=ie(ee(e),r,i);return t.forEach((t=>n.sample(t))),n.quantizeSync()}async function Kt(t,{colorDistanceFormula:e,paletteQuantization:r,colors:i,onProgress:n}={}){return new Promise(((a,o)=>{const s=ie(ee(e),r,i);let h;t.forEach((t=>s.sample(t)));const l=s.quantize(),f=()=>{try{const t=l.next();t.done?a(h):(t.value.palette&&(h=t.value.palette),n&&n(t.value.progress),Jt(f))}catch(t){o(t)}};Jt(f)}))}function $t(t,e,{colorDistanceFormula:r,imageQuantization:i}={}){return re(ee(r),i).quantizeSync(t,e)}async function te(t,e,{colorDistanceFormula:r,imageQuantization:i,onProgress:n}={}){return new Promise(((a,o)=>{let s;const h=re(ee(r),i).quantize(t,e),l=()=>{try{const t=h.next();t.done?a(s):(t.value.pointContainer&&(s=t.value.pointContainer),n&&n(t.value.progress),Jt(l))}catch(t){o(t)}};Jt(l)}))}function ee(t="euclidean-bt709"){switch(t){case"cie94-graphic-arts":return new Y;case"cie94-textiles":return new Z;case"ciede2000":return new X;case"color-metric":return new J;case"euclidean":return new K;case"euclidean-bt709":return new $;case"euclidean-bt709-noalpha":return new tt;case"manhattan":return new rt;case"manhattan-bt709":return new nt;case"manhattan-nommyde":return new it;case"pngquant":return new at;default:throw new Error(`Unknown colorDistanceFormula ${t}`)}}function re(t,e="floyd-steinberg"){switch(e){case"nearest":return new zt(t);case"riemersma":return new Ht(t);case"floyd-steinberg":return new Nt(t,0);case"false-floyd-steinberg":return new Nt(t,1);case"stucki":return new Nt(t,2);case"atkinson":return new Nt(t,3);case"jarvis":return new Nt(t,4);case"burkes":return new Nt(t,5);case"sierra":return new Nt(t,6);case"two-sierra":return new Nt(t,7);case"sierra-lite":return new Nt(t,8);default:throw new Error(`Unknown imageQuantization ${e}`)}}function ie(t,e="wuquant",r=256){switch(e){case"neuquant":return new yt(t,r);case"rgbquant":return new Mt(t,r);case"wuquant":return new Lt(t,r);case"neuquant-float":return new xt(t,r);default:throw new Error(`Unknown paletteQuantization ${e}`)}}t.exports=l(u)}},__webpack_module_cache__={};function __webpack_require__(t){var e=__webpack_module_cache__[t];if(void 0!==e)return e.exports;var r=__webpack_module_cache__[t]={exports:{}};return __webpack_modules__[t](r,r.exports,__webpack_require__),r.exports}__webpack_require__.n=t=>{var e=t&&t.__esModule?()=>t.default:()=>t;return __webpack_require__.d(e,{a:e}),e},__webpack_require__.d=(t,e)=>{for(var r in e)__webpack_require__.o(e,r)&&!__webpack_require__.o(t,r)&&Object.defineProperty(t,r,{enumerable:!0,get:e[r]})},__webpack_require__.g=function(){if("object"==typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(t){if("object"==typeof window)return window}}(),__webpack_require__.o=(t,e)=>Object.prototype.hasOwnProperty.call(t,e),__webpack_require__.r=t=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0})};var __webpack_exports__={};(()=>{"use strict";var t={};__webpack_require__.r(t),__webpack_require__.d(t,{AUTO:()=>et,BLEND_ADD:()=>ut,BLEND_DARKEN:()=>pt,BLEND_DESTINATION_OVER:()=>lt,BLEND_DIFFERENCE:()=>bt,BLEND_EXCLUSION:()=>_t,BLEND_HARDLIGHT:()=>gt,BLEND_LIGHTEN:()=>mt,BLEND_MULTIPLY:()=>ft,BLEND_OVERLAY:()=>dt,BLEND_SCREEN:()=>ct,BLEND_SOURCE_OVER:()=>ht,EDGE_CROP:()=>vt,EDGE_EXTEND:()=>yt,EDGE_WRAP:()=>wt,HORIZONTAL_ALIGN_CENTER:()=>it,HORIZONTAL_ALIGN_LEFT:()=>rt,HORIZONTAL_ALIGN_RIGHT:()=>nt,VERTICAL_ALIGN_BOTTOM:()=>st,VERTICAL_ALIGN_MIDDLE:()=>ot,VERTICAL_ALIGN_TOP:()=>at});var e={};__webpack_require__.r(e),__webpack_require__.d(e,{add:()=>St,darken:()=>It,difference:()=>Rt,dstOver:()=>Et,exclusion:()=>Pt,hardLight:()=>Tt,lighten:()=>Bt,multiply:()=>kt,overlay:()=>At,screen:()=>Mt,srcOver:()=>xt});var r=__webpack_require__(5546),i=__webpack_require__.n(r),n=__webpack_require__(1023),a=__webpack_require__.n(n),o=__webpack_require__(2699),s=__webpack_require__.n(o);function h(t){if(void 0===t)return!1;if("function"!=typeof t)throw new TypeError("Callback must be a function");return!0}function l(t,e){if("string"==typeof t&&(t=new Error(t)),"function"==typeof e)return e.call(this,t);throw t}function f(t,e,r,i,n,a){e=Math.round(e),r=Math.round(r),i=Math.round(i),n=Math.round(n);for(let o=r;o<r+n;o++)for(let r=e;r<e+i;r++){const e=t.bitmap.width*o+r<<2;a.call(t,r,o,e)}return t}var u=__webpack_require__(236),c=__webpack_require__.n(u),d=__webpack_require__(1294),p=__webpack_require__.n(d);function m(t){return m="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},m(t)}var g=/^\s+/,b=/\s+$/;function _(t,e){if(e=e||{},(t=t||"")instanceof _)return t;if(!(this instanceof _))return new _(t,e);var r=function(t){var e,r,i,n={r:0,g:0,b:0},a=1,o=null,s=null,h=null,l=!1,f=!1;return"string"==typeof t&&(t=function(t){t=t.replace(g,"").replace(b,"").toLowerCase();var e,r=!1;if(C[t])t=C[t],r=!0;else if("transparent"==t)return{r:0,g:0,b:0,a:0,format:"name"};return(e=V.rgb.exec(t))?{r:e[1],g:e[2],b:e[3]}:(e=V.rgba.exec(t))?{r:e[1],g:e[2],b:e[3],a:e[4]}:(e=V.hsl.exec(t))?{h:e[1],s:e[2],l:e[3]}:(e=V.hsla.exec(t))?{h:e[1],s:e[2],l:e[3],a:e[4]}:(e=V.hsv.exec(t))?{h:e[1],s:e[2],v:e[3]}:(e=V.hsva.exec(t))?{h:e[1],s:e[2],v:e[3],a:e[4]}:(e=V.hex8.exec(t))?{r:F(e[1]),g:F(e[2]),b:F(e[3]),a:W(e[4]),format:r?"name":"hex8"}:(e=V.hex6.exec(t))?{r:F(e[1]),g:F(e[2]),b:F(e[3]),format:r?"name":"hex"}:(e=V.hex4.exec(t))?{r:F(e[1]+""+e[1]),g:F(e[2]+""+e[2]),b:F(e[3]+""+e[3]),a:W(e[4]+""+e[4]),format:r?"name":"hex8"}:!!(e=V.hex3.exec(t))&&{r:F(e[1]+""+e[1]),g:F(e[2]+""+e[2]),b:F(e[3]+""+e[3]),format:r?"name":"hex"}}(t)),"object"==m(t)&&(X(t.r)&&X(t.g)&&X(t.b)?(e=t.r,r=t.g,i=t.b,n={r:255*D(e,255),g:255*D(r,255),b:255*D(i,255)},l=!0,f="%"===String(t.r).substr(-1)?"prgb":"rgb"):X(t.h)&&X(t.s)&&X(t.v)?(o=G(t.s),s=G(t.v),n=function(t,e,r){t=6*D(t,360),e=D(e,100),r=D(r,100);var i=Math.floor(t),n=t-i,a=r*(1-e),o=r*(1-n*e),s=r*(1-(1-n)*e),h=i%6;return{r:255*[r,o,a,a,s,r][h],g:255*[s,r,r,o,a,a][h],b:255*[a,a,s,r,r,o][h]}}(t.h,o,s),l=!0,f="hsv"):X(t.h)&&X(t.s)&&X(t.l)&&(o=G(t.s),h=G(t.l),n=function(t,e,r){var i,n,a;function o(t,e,r){return r<0&&(r+=1),r>1&&(r-=1),r<1/6?t+6*(e-t)*r:r<.5?e:r<2/3?t+(e-t)*(2/3-r)*6:t}if(t=D(t,360),e=D(e,100),r=D(r,100),0===e)i=n=a=r;else{var s=r<.5?r*(1+e):r+e-r*e,h=2*r-s;i=o(h,s,t+1/3),n=o(h,s,t),a=o(h,s,t-1/3)}return{r:255*i,g:255*n,b:255*a}}(t.h,o,h),l=!0,f="hsl"),t.hasOwnProperty("a")&&(a=t.a)),a=z(a),{ok:l,format:t.format||f,r:Math.min(255,Math.max(n.r,0)),g:Math.min(255,Math.max(n.g,0)),b:Math.min(255,Math.max(n.b,0)),a}}(t);this._originalInput=t,this._r=r.r,this._g=r.g,this._b=r.b,this._a=r.a,this._roundA=Math.round(100*this._a)/100,this._format=e.format||r.format,this._gradientType=e.gradientType,this._r<1&&(this._r=Math.round(this._r)),this._g<1&&(this._g=Math.round(this._g)),this._b<1&&(this._b=Math.round(this._b)),this._ok=r.ok}function y(t,e,r){t=D(t,255),e=D(e,255),r=D(r,255);var i,n,a=Math.max(t,e,r),o=Math.min(t,e,r),s=(a+o)/2;if(a==o)i=n=0;else{var h=a-o;switch(n=s>.5?h/(2-a-o):h/(a+o),a){case t:i=(e-r)/h+(e<r?6:0);break;case e:i=(r-t)/h+2;break;case r:i=(t-e)/h+4}i/=6}return{h:i,s:n,l:s}}function w(t,e,r){t=D(t,255),e=D(e,255),r=D(r,255);var i,n,a=Math.max(t,e,r),o=Math.min(t,e,r),s=a,h=a-o;if(n=0===a?0:h/a,a==o)i=0;else{switch(a){case t:i=(e-r)/h+(e<r?6:0);break;case e:i=(r-t)/h+2;break;case r:i=(t-e)/h+4}i/=6}return{h:i,s:n,v:s}}function v(t,e,r,i){var n=[j(Math.round(t).toString(16)),j(Math.round(e).toString(16)),j(Math.round(r).toString(16))];return i&&n[0].charAt(0)==n[0].charAt(1)&&n[1].charAt(0)==n[1].charAt(1)&&n[2].charAt(0)==n[2].charAt(1)?n[0].charAt(0)+n[1].charAt(0)+n[2].charAt(0):n.join("")}function x(t,e,r,i){return[j(H(i)),j(Math.round(t).toString(16)),j(Math.round(e).toString(16)),j(Math.round(r).toString(16))].join("")}function E(t,e){e=0===e?0:e||10;var r=_(t).toHsl();return r.s-=e/100,r.s=N(r.s),_(r)}function k(t,e){e=0===e?0:e||10;var r=_(t).toHsl();return r.s+=e/100,r.s=N(r.s),_(r)}function S(t){return _(t).desaturate(100)}function M(t,e){e=0===e?0:e||10;var r=_(t).toHsl();return r.l+=e/100,r.l=N(r.l),_(r)}function A(t,e){e=0===e?0:e||10;var r=_(t).toRgb();return r.r=Math.max(0,Math.min(255,r.r-Math.round(-e/100*255))),r.g=Math.max(0,Math.min(255,r.g-Math.round(-e/100*255))),r.b=Math.max(0,Math.min(255,r.b-Math.round(-e/100*255))),_(r)}function I(t,e){e=0===e?0:e||10;var r=_(t).toHsl();return r.l-=e/100,r.l=N(r.l),_(r)}function B(t,e){var r=_(t).toHsl(),i=(r.h+e)%360;return r.h=i<0?360+i:i,_(r)}function T(t){var e=_(t).toHsl();return e.h=(e.h+180)%360,_(e)}function R(t,e){if(isNaN(e)||e<=0)throw new Error("Argument to polyad must be a positive number");for(var r=_(t).toHsl(),i=[_(t)],n=360/e,a=1;a<e;a++)i.push(_({h:(r.h+a*n)%360,s:r.s,l:r.l}));return i}function P(t){var e=_(t).toHsl(),r=e.h;return[_(t),_({h:(r+72)%360,s:e.s,l:e.l}),_({h:(r+216)%360,s:e.s,l:e.l})]}function O(t,e,r){e=e||6,r=r||30;var i=_(t).toHsl(),n=360/r,a=[_(t)];for(i.h=(i.h-(n*e>>1)+720)%360;--e;)i.h=(i.h+n)%360,a.push(_(i));return a}function L(t,e){e=e||6;for(var r=_(t).toHsv(),i=r.h,n=r.s,a=r.v,o=[],s=1/e;e--;)o.push(_({h:i,s:n,v:a})),a=(a+s)%1;return o}_.prototype={isDark:function(){return this.getBrightness()<128},isLight:function(){return!this.isDark()},isValid:function(){return this._ok},getOriginalInput:function(){return this._originalInput},getFormat:function(){return this._format},getAlpha:function(){return this._a},getBrightness:function(){var t=this.toRgb();return(299*t.r+587*t.g+114*t.b)/1e3},getLuminance:function(){var t,e,r,i=this.toRgb();return t=i.r/255,e=i.g/255,r=i.b/255,.2126*(t<=.03928?t/12.92:Math.pow((t+.055)/1.055,2.4))+.7152*(e<=.03928?e/12.92:Math.pow((e+.055)/1.055,2.4))+.0722*(r<=.03928?r/12.92:Math.pow((r+.055)/1.055,2.4))},setAlpha:function(t){return this._a=z(t),this._roundA=Math.round(100*this._a)/100,this},toHsv:function(){var t=w(this._r,this._g,this._b);return{h:360*t.h,s:t.s,v:t.v,a:this._a}},toHsvString:function(){var t=w(this._r,this._g,this._b),e=Math.round(360*t.h),r=Math.round(100*t.s),i=Math.round(100*t.v);return 1==this._a?"hsv("+e+", "+r+"%, "+i+"%)":"hsva("+e+", "+r+"%, "+i+"%, "+this._roundA+")"},toHsl:function(){var t=y(this._r,this._g,this._b);return{h:360*t.h,s:t.s,l:t.l,a:this._a}},toHslString:function(){var t=y(this._r,this._g,this._b),e=Math.round(360*t.h),r=Math.round(100*t.s),i=Math.round(100*t.l);return 1==this._a?"hsl("+e+", "+r+"%, "+i+"%)":"hsla("+e+", "+r+"%, "+i+"%, "+this._roundA+")"},toHex:function(t){return v(this._r,this._g,this._b,t)},toHexString:function(t){return"#"+this.toHex(t)},toHex8:function(t){return function(t,e,r,i,n){var a=[j(Math.round(t).toString(16)),j(Math.round(e).toString(16)),j(Math.round(r).toString(16)),j(H(i))];return n&&a[0].charAt(0)==a[0].charAt(1)&&a[1].charAt(0)==a[1].charAt(1)&&a[2].charAt(0)==a[2].charAt(1)&&a[3].charAt(0)==a[3].charAt(1)?a[0].charAt(0)+a[1].charAt(0)+a[2].charAt(0)+a[3].charAt(0):a.join("")}(this._r,this._g,this._b,this._a,t)},toHex8String:function(t){return"#"+this.toHex8(t)},toRgb:function(){return{r:Math.round(this._r),g:Math.round(this._g),b:Math.round(this._b),a:this._a}},toRgbString:function(){return 1==this._a?"rgb("+Math.round(this._r)+", "+Math.round(this._g)+", "+Math.round(this._b)+")":"rgba("+Math.round(this._r)+", "+Math.round(this._g)+", "+Math.round(this._b)+", "+this._roundA+")"},toPercentageRgb:function(){return{r:Math.round(100*D(this._r,255))+"%",g:Math.round(100*D(this._g,255))+"%",b:Math.round(100*D(this._b,255))+"%",a:this._a}},toPercentageRgbString:function(){return 1==this._a?"rgb("+Math.round(100*D(this._r,255))+"%, "+Math.round(100*D(this._g,255))+"%, "+Math.round(100*D(this._b,255))+"%)":"rgba("+Math.round(100*D(this._r,255))+"%, "+Math.round(100*D(this._g,255))+"%, "+Math.round(100*D(this._b,255))+"%, "+this._roundA+")"},toName:function(){return 0===this._a?"transparent":!(this._a<1)&&(U[v(this._r,this._g,this._b,!0)]||!1)},toFilter:function(t){var e="#"+x(this._r,this._g,this._b,this._a),r=e,i=this._gradientType?"GradientType = 1, ":"";if(t){var n=_(t);r="#"+x(n._r,n._g,n._b,n._a)}return"progid:DXImageTransform.Microsoft.gradient("+i+"startColorstr="+e+",endColorstr="+r+")"},toString:function(t){var e=!!t;t=t||this._format;var r=!1,i=this._a<1&&this._a>=0;return e||!i||"hex"!==t&&"hex6"!==t&&"hex3"!==t&&"hex4"!==t&&"hex8"!==t&&"name"!==t?("rgb"===t&&(r=this.toRgbString()),"prgb"===t&&(r=this.toPercentageRgbString()),"hex"!==t&&"hex6"!==t||(r=this.toHexString()),"hex3"===t&&(r=this.toHexString(!0)),"hex4"===t&&(r=this.toHex8String(!0)),"hex8"===t&&(r=this.toHex8String()),"name"===t&&(r=this.toName()),"hsl"===t&&(r=this.toHslString()),"hsv"===t&&(r=this.toHsvString()),r||this.toHexString()):"name"===t&&0===this._a?this.toName():this.toRgbString()},clone:function(){return _(this.toString())},_applyModification:function(t,e){var r=t.apply(null,[this].concat([].slice.call(e)));return this._r=r._r,this._g=r._g,this._b=r._b,this.setAlpha(r._a),this},lighten:function(){return this._applyModification(M,arguments)},brighten:function(){return this._applyModification(A,arguments)},darken:function(){return this._applyModification(I,arguments)},desaturate:function(){return this._applyModification(E,arguments)},saturate:function(){return this._applyModification(k,arguments)},greyscale:function(){return this._applyModification(S,arguments)},spin:function(){return this._applyModification(B,arguments)},_applyCombination:function(t,e){return t.apply(null,[this].concat([].slice.call(e)))},analogous:function(){return this._applyCombination(O,arguments)},complement:function(){return this._applyCombination(T,arguments)},monochromatic:function(){return this._applyCombination(L,arguments)},splitcomplement:function(){return this._applyCombination(P,arguments)},triad:function(){return this._applyCombination(R,[3])},tetrad:function(){return this._applyCombination(R,[4])}},_.fromRatio=function(t,e){if("object"==m(t)){var r={};for(var i in t)t.hasOwnProperty(i)&&(r[i]="a"===i?t[i]:G(t[i]));t=r}return _(t,e)},_.equals=function(t,e){return!(!t||!e)&&_(t).toRgbString()==_(e).toRgbString()},_.random=function(){return _.fromRatio({r:Math.random(),g:Math.random(),b:Math.random()})},_.mix=function(t,e,r){r=0===r?0:r||50;var i=_(t).toRgb(),n=_(e).toRgb(),a=r/100;return _({r:(n.r-i.r)*a+i.r,g:(n.g-i.g)*a+i.g,b:(n.b-i.b)*a+i.b,a:(n.a-i.a)*a+i.a})},_.readability=function(t,e){var r=_(t),i=_(e);return(Math.max(r.getLuminance(),i.getLuminance())+.05)/(Math.min(r.getLuminance(),i.getLuminance())+.05)},_.isReadable=function(t,e,r){var i,n,a,o,s,h=_.readability(t,e);switch(n=!1,(a=r,"AA"!==(o=((a=a||{level:"AA",size:"small"}).level||"AA").toUpperCase())&&"AAA"!==o&&(o="AA"),"small"!==(s=(a.size||"small").toLowerCase())&&"large"!==s&&(s="small"),i={level:o,size:s}).level+i.size){case"AAsmall":case"AAAlarge":n=h>=4.5;break;case"AAlarge":n=h>=3;break;case"AAAsmall":n=h>=7}return n},_.mostReadable=function(t,e,r){var i,n,a,o,s=null,h=0;n=(r=r||{}).includeFallbackColors,a=r.level,o=r.size;for(var l=0;l<e.length;l++)(i=_.readability(t,e[l]))>h&&(h=i,s=_(e[l]));return _.isReadable(t,s,{level:a,size:o})||!n?s:(r.includeFallbackColors=!1,_.mostReadable(t,["#fff","#000"],r))};var C=_.names={aliceblue:"f0f8ff",antiquewhite:"faebd7",aqua:"0ff",aquamarine:"7fffd4",azure:"f0ffff",beige:"f5f5dc",bisque:"ffe4c4",black:"000",blanchedalmond:"ffebcd",blue:"00f",blueviolet:"8a2be2",brown:"a52a2a",burlywood:"deb887",burntsienna:"ea7e5d",cadetblue:"5f9ea0",chartreuse:"7fff00",chocolate:"d2691e",coral:"ff7f50",cornflowerblue:"6495ed",cornsilk:"fff8dc",crimson:"dc143c",cyan:"0ff",darkblue:"00008b",darkcyan:"008b8b",darkgoldenrod:"b8860b",darkgray:"a9a9a9",darkgreen:"006400",darkgrey:"a9a9a9",darkkhaki:"bdb76b",darkmagenta:"8b008b",darkolivegreen:"556b2f",darkorange:"ff8c00",darkorchid:"9932cc",darkred:"8b0000",darksalmon:"e9967a",darkseagreen:"8fbc8f",darkslateblue:"483d8b",darkslategray:"2f4f4f",darkslategrey:"2f4f4f",darkturquoise:"00ced1",darkviolet:"9400d3",deeppink:"ff1493",deepskyblue:"00bfff",dimgray:"696969",dimgrey:"696969",dodgerblue:"1e90ff",firebrick:"b22222",floralwhite:"fffaf0",forestgreen:"228b22",fuchsia:"f0f",gainsboro:"dcdcdc",ghostwhite:"f8f8ff",gold:"ffd700",goldenrod:"daa520",gray:"808080",green:"008000",greenyellow:"adff2f",grey:"808080",honeydew:"f0fff0",hotpink:"ff69b4",indianred:"cd5c5c",indigo:"4b0082",ivory:"fffff0",khaki:"f0e68c",lavender:"e6e6fa",lavenderblush:"fff0f5",lawngreen:"7cfc00",lemonchiffon:"fffacd",lightblue:"add8e6",lightcoral:"f08080",lightcyan:"e0ffff",lightgoldenrodyellow:"fafad2",lightgray:"d3d3d3",lightgreen:"90ee90",lightgrey:"d3d3d3",lightpink:"ffb6c1",lightsalmon:"ffa07a",lightseagreen:"20b2aa",lightskyblue:"87cefa",lightslategray:"789",lightslategrey:"789",lightsteelblue:"b0c4de",lightyellow:"ffffe0",lime:"0f0",limegreen:"32cd32",linen:"faf0e6",magenta:"f0f",maroon:"800000",mediumaquamarine:"66cdaa",mediumblue:"0000cd",mediumorchid:"ba55d3",mediumpurple:"9370db",mediumseagreen:"3cb371",mediumslateblue:"7b68ee",mediumspringgreen:"00fa9a",mediumturquoise:"48d1cc",mediumvioletred:"c71585",midnightblue:"191970",mintcream:"f5fffa",mistyrose:"ffe4e1",moccasin:"ffe4b5",navajowhite:"ffdead",navy:"000080",oldlace:"fdf5e6",olive:"808000",olivedrab:"6b8e23",orange:"ffa500",orangered:"ff4500",orchid:"da70d6",palegoldenrod:"eee8aa",palegreen:"98fb98",paleturquoise:"afeeee",palevioletred:"db7093",papayawhip:"ffefd5",peachpuff:"ffdab9",peru:"cd853f",pink:"ffc0cb",plum:"dda0dd",powderblue:"b0e0e6",purple:"800080",rebeccapurple:"663399",red:"f00",rosybrown:"bc8f8f",royalblue:"4169e1",saddlebrown:"8b4513",salmon:"fa8072",sandybrown:"f4a460",seagreen:"2e8b57",seashell:"fff5ee",sienna:"a0522d",silver:"c0c0c0",skyblue:"87ceeb",slateblue:"6a5acd",slategray:"708090",slategrey:"708090",snow:"fffafa",springgreen:"00ff7f",steelblue:"4682b4",tan:"d2b48c",teal:"008080",thistle:"d8bfd8",tomato:"ff6347",turquoise:"40e0d0",violet:"ee82ee",wheat:"f5deb3",white:"fff",whitesmoke:"f5f5f5",yellow:"ff0",yellowgreen:"9acd32"},U=_.hexNames=function(t){var e={};for(var r in t)t.hasOwnProperty(r)&&(e[t[r]]=r);return e}(C);function z(t){return t=parseFloat(t),(isNaN(t)||t<0||t>1)&&(t=1),t}function D(t,e){(function(t){return"string"==typeof t&&-1!=t.indexOf(".")&&1===parseFloat(t)})(t)&&(t="100%");var r=function(t){return"string"==typeof t&&-1!=t.indexOf("%")}(t);return t=Math.min(e,Math.max(0,parseFloat(t))),r&&(t=parseInt(t*e,10)/100),Math.abs(t-e)<1e-6?1:t%e/parseFloat(e)}function N(t){return Math.min(1,Math.max(0,t))}function F(t){return parseInt(t,16)}function j(t){return 1==t.length?"0"+t:""+t}function G(t){return t<=1&&(t=100*t+"%"),t}function H(t){return Math.round(255*parseFloat(t)).toString(16)}function W(t){return F(t)/255}var q,Z,Y,V=(Z="[\\s|\\(]+("+(q="(?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?)")+")[,|\\s]+("+q+")[,|\\s]+("+q+")\\s*\\)?",Y="[\\s|\\(]+("+q+")[,|\\s]+("+q+")[,|\\s]+("+q+")[,|\\s]+("+q+")\\s*\\)?",{CSS_UNIT:new RegExp(q),rgb:new RegExp("rgb"+Z),rgba:new RegExp("rgba"+Y),hsl:new RegExp("hsl"+Z),hsla:new RegExp("hsla"+Y),hsv:new RegExp("hsv"+Z),hsva:new RegExp("hsva"+Y),hex3:/^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,hex6:/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,hex4:/^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,hex8:/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/});function X(t){return!!V.CSS_UNIT.exec(t)}function J(t,e){this.size=this.size||t,this.smallerSize=this.smallerSize||e,function(t){for(let e=1;e<t;e++)K[e]=1;K[0]=1/Math.sqrt(2)}(this.size)}function Q(t){const e=255&t,r=255&(t>>>=8),i=255&(t>>>=8);return{r:255&(t>>>=8),g:i,b:r,a:e}}J.prototype.size=32,J.prototype.smallerSize=8,J.prototype.distance=function(t,e){let r=0;for(let i=0;i<t.length;i++)t[i]!==e[i]&&r++;return r/t.length},J.prototype.getHash=function(t){(t=t.clone().resize(this.size,this.size)).grayscale();const e=[];for(let r=0;r<t.bitmap.width;r++){e[r]=[];for(let i=0;i<t.bitmap.height;i++)e[r][i]=Q(t.getPixelColor(r,i)).b}const r=function(t,e){const r=e,i=[];for(let e=0;e<r;e++){i[e]=[];for(let n=0;n<r;n++){let a=0;for(let i=0;i<r;i++)for(let o=0;o<r;o++)a+=Math.cos((2*i+1)/(2*r)*e*Math.PI)*Math.cos((2*o+1)/(2*r)*n*Math.PI)*t[i][o];a*=K[e]*K[n]/4,i[e][n]=a}}return i}(e,this.size);let i=0;for(let t=0;t<this.smallerSize;t++)for(let e=0;e<this.smallerSize;e++)i+=r[t][e];const n=i/(this.smallerSize*this.smallerSize);let a="";for(let t=0;t<this.smallerSize;t++)for(let e=0;e<this.smallerSize;e++)a+=r[t][e]>n?"1":"0";return a};const K=[],$=J;__webpack_require__(9307);const tt=(t,e)=>{let{url:r,...i}=t;fetch(r,i).then((t=>{if(t.ok)return t.arrayBuffer().catch((t=>{throw new Error(`Response is not a buffer for url ${r}. Error: ${t.message}`)}));throw new Error(`HTTP Status ${t.status} for url ${r}`)})).then((t=>e(null,t))).catch((t=>e(t)))},et=-1,rt=1,it=2,nt=4,at=8,ot=16,st=32,ht="srcOver",lt="dstOver",ft="multiply",ut="add",ct="screen",dt="overlay",pt="darken",mt="lighten",gt="hardLight",bt="difference",_t="exclusion",yt=1,wt=2,vt=3;function xt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a;return{r:(t.r*t.a+e.r*e.a*(1-t.a))/i,g:(t.g*t.a+e.g*e.a*(1-t.a))/i,b:(t.b*t.a+e.b*e.a*(1-t.a))/i,a:i}}function Et(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a;return{r:(e.r*e.a+t.r*t.a*(1-e.a))/i,g:(e.g*e.a+t.g*t.a*(1-e.a))/i,b:(e.b*e.a+t.b*t.a*(1-e.a))/i,a:i}}function kt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(n*s+n*(1-e.a)+s*(1-t.a))/i,g:(a*h+a*(1-e.a)+h*(1-t.a))/i,b:(o*l+o*(1-e.a)+l*(1-t.a))/i,a:i}}function St(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a;return{r:(n+e.r*e.a)/i,g:(a+e.g*e.a)/i,b:(o+e.b*e.a)/i,a:i}}function Mt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(n*e.a+s*t.a-n*s+n*(1-e.a)+s*(1-t.a))/i,g:(a*e.a+h*t.a-a*h+a*(1-e.a)+h*(1-t.a))/i,b:(o*e.a+l*t.a-o*l+o*(1-e.a)+l*(1-t.a))/i,a:i}}function At(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(2*s<=e.a?2*n*s+n*(1-e.a)+s*(1-t.a):n*(1+e.a)+s*(1+t.a)-2*s*n-e.a*t.a)/i,g:(2*h<=e.a?2*a*h+a*(1-e.a)+h*(1-t.a):a*(1+e.a)+h*(1+t.a)-2*h*a-e.a*t.a)/i,b:(2*l<=e.a?2*o*l+o*(1-e.a)+l*(1-t.a):o*(1+e.a)+l*(1+t.a)-2*l*o-e.a*t.a)/i,a:i}}function It(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(Math.min(n*e.a,s*t.a)+n*(1-e.a)+s*(1-t.a))/i,g:(Math.min(a*e.a,h*t.a)+a*(1-e.a)+h*(1-t.a))/i,b:(Math.min(o*e.a,l*t.a)+o*(1-e.a)+l*(1-t.a))/i,a:i}}function Bt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(Math.max(n*e.a,s*t.a)+n*(1-e.a)+s*(1-t.a))/i,g:(Math.max(a*e.a,h*t.a)+a*(1-e.a)+h*(1-t.a))/i,b:(Math.max(o*e.a,l*t.a)+o*(1-e.a)+l*(1-t.a))/i,a:i}}function Tt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(2*n<=t.a?2*n*s+n*(1-e.a)+s*(1-t.a):n*(1+e.a)+s*(1+t.a)-2*s*n-e.a*t.a)/i,g:(2*a<=t.a?2*a*h+a*(1-e.a)+h*(1-t.a):a*(1+e.a)+h*(1+t.a)-2*h*a-e.a*t.a)/i,b:(2*o<=t.a?2*o*l+o*(1-e.a)+l*(1-t.a):o*(1+e.a)+l*(1+t.a)-2*l*o-e.a*t.a)/i,a:i}}function Rt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(n+s-2*Math.min(n*e.a,s*t.a))/i,g:(a+h-2*Math.min(a*e.a,h*t.a))/i,b:(o+l-2*Math.min(o*e.a,l*t.a))/i,a:i}}function Pt(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1;t.a*=r;const i=e.a+t.a-e.a*t.a,n=t.r*t.a,a=t.g*t.a,o=t.b*t.a,s=e.r*e.a,h=e.g*e.a,l=e.b*e.a;return{r:(n*e.a+s*t.a-2*n*s+n*(1-e.a)+s*(1-t.a))/i,g:(a*e.a+h*t.a-2*a*h+a*(1-e.a)+h*(1-t.a))/i,b:(o*e.a+l*t.a-2*o*l+o*(1-e.a)+l*(1-t.a))/i,a:i}}const Ot=function(t,e){for(var r=arguments.length,i=new Array(r>2?r-2:0),n=2;n<r;n++)i[n-2]=arguments[n];return new Promise(((r,n)=>{i.push(((t,e)=>{t&&n(t),r(e)})),t.bind(e)(...i)}))},Lt={},Ct=(t,e)=>{Lt[t]=e},Ut=t=>{const e=t.split("/").slice(-1);var r;return(r=e[e.length-1].split(".").pop(),Object.entries(Lt).find((t=>t[1].includes(r)))||[])[0]};var zt=__webpack_require__(5025),Dt=__webpack_require__.n(zt),Nt=__webpack_require__(6551),Ft=__webpack_require__.n(Nt),jt=__webpack_require__(8834).lW;function Gt(t){return t._exif&&t._exif.tags&&t._exif.tags.Orientation||1}async function Ht(t,e,r){const i=await async function(t,e){const r=await Dt().fromBuffer(t);return r?r.mime:e?Ut(e):null}(t,e);if("string"!=typeof i)return r(new Error("Could not find MIME for Buffer <"+e+">"));this._originalMime=i.toLowerCase();try{const e=this.getMIME();if(!this.constructor.decoders[e])return l.call(this,"Unsupported MIME type: "+e,r);this.bitmap=this.constructor.decoders[e](t)}catch(t){return r.call(this,t,this)}try{this._exif=Ft().create(t).parse(),function(t){if(Gt(t)<2)return;const e=function(t){const e=t.getWidth(),r=t.getHeight();switch(Gt(t)){case 1:default:return null;case 2:return function(t,r){return[e-t-1,r]};case 3:return function(t,i){return[e-t-1,r-i-1]};case 4:return function(t,e){return[t,r-e-1]};case 5:return function(t,e){return[e,t]};case 6:return function(t,e){return[e,r-t-1]};case 7:return function(t,i){return[e-i-1,r-t-1]};case 8:return function(t,r){return[e-r-1,t]}}}(t),r=Gt(t)>4;!function(t,e,r,i){const n=t.bitmap.data,a=t.bitmap.width,o=jt.alloc(n.length);for(let t=0;t<e;t++)for(let s=0;s<r;s++){const[r,h]=i(t,s),l=e*s+t<<2,f=a*h+r<<2,u=n.readUInt32BE(f);o.writeUInt32BE(u,l)}t.bitmap.data=o,t.bitmap.width=e,t.bitmap.height=r}(t,r?t.bitmap.height:t.bitmap.width,r?t.bitmap.width:t.bitmap.height,e)}(this)}catch(t){}return r.call(this,null,this),this}function Wt(t,e){if(t===et&&(t=this.getMIME()),"string"!=typeof t)return l.call(this,"mime must be a string",e);if("function"!=typeof e)return l.call(this,"cb must be a function",e);if(t=t.toLowerCase(),this._rgba&&this.constructor.hasAlpha[t]?this.bitmap.data=jt.from(this.bitmap.data):this.bitmap.data=function(t,e){return new t(e.bitmap.width,e.bitmap.height,e._background).composite(e,0,0).bitmap}(this.constructor,this).data,!this.constructor.encoders[t])return l.call(this,"Unsupported MIME type: "+t,e);{const r=this.constructor.encoders[t](this);r instanceof Promise?r.then((t=>{e.call(this,null,t)})):e.call(this,null,r)}return this}function qt(t){return Ot(Wt,this,t)}var Zt=__webpack_require__(8834).lW;function Yt(t,e,r){return(e=function(t){var e=function(t,e){if("object"!=typeof t||null===t)return t;var r=t[Symbol.toPrimitive];if(void 0!==r){var i=r.call(t,"string");if("object"!=typeof i)return i;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(t);return"symbol"==typeof e?e:String(e)}(e))in t?Object.defineProperty(t,e,{value:r,enumerable:!0,configurable:!0,writable:!0}):t[e]=r,t}const Vt="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_",Xt=[NaN,NaN];for(let t=2;t<65;t++){const e=c()(c().BIN,Vt.slice(0,t))(new Array(65).join("1"));Xt.push(e.length)}function Jt(){}function Qt(t){return Object.prototype.toString.call(t).toLowerCase().indexOf("arraybuffer")>-1}function Kt(t){const e=Zt.alloc(t.byteLength),r=new Uint8Array(t);for(let t=0;t<e.length;++t)e[t]=r[t];return e}function $t(t,e){tt(t,((r,i)=>r?e(r):"object"==typeof i&&Zt.isBuffer(i)?e(null,i):"object"==typeof i&&Qt(i)?e(null,Kt(i)):new Error(`Could not load Buffer from <${t.url}>`)))}const te={data:null,width:null,height:null};class ee extends(s()){constructor(){for(var t=arguments.length,e=new Array(t),r=0;r<t;r++)e[r]=arguments[r];super(),Yt(this,"bitmap",te),Yt(this,"_background",0),Yt(this,"_originalMime",ee.MIME_PNG),Yt(this,"_exif",null),Yt(this,"_rgba",!0),Yt(this,"writeAsync",(t=>Ot(this.write,this,t))),Yt(this,"getBase64Async",(t=>Ot(this.getBase64,this,t))),Yt(this,"getBuffer",Wt),Yt(this,"getBufferAsync",qt),Yt(this,"getPixelColour",this.getPixelColor),Yt(this,"setPixelColour",this.setPixelColor);const n=this;let a=Jt;function o(){for(var t=arguments.length,e=new Array(t),r=0;r<t;r++)e[r]=arguments[r];const[i]=e;(i||{}).methodName="constructor",setTimeout((()=>{i&&a===Jt?n.emitError("constructor",i):i||n.emitMulti("constructor","initialized"),a.call(n,...e)}),1)}if(Qt(e[0])&&(e[0]=Kt(e[0])),"number"==typeof e[0]&&"number"==typeof e[1]||parseInt(e[0],10)&&parseInt(e[1],10)){const t=parseInt(e[0],10),r=parseInt(e[1],10);if(a=e[2],"number"==typeof e[2]&&(this._background=e[2],a=e[3]),"string"==typeof e[2]&&(this._background=ee.cssColorToHex(e[2]),a=e[3]),void 0===a&&(a=Jt),"function"!=typeof a)return l.call(this,"cb must be a function",o);this.bitmap={data:Zt.alloc(t*r*4),width:t,height:r};for(let t=0;t<this.bitmap.data.length;t+=4)this.bitmap.data.writeUInt32BE(this._background,t);o(null,this)}else if("object"==typeof e[0]&&e[0].url){if(a=e[1]||Jt,"function"!=typeof a)return l.call(this,"cb must be a function",o);$t(e[0],((t,r)=>{if(t)return l.call(this,t,o);this.parseBitmap(r,e[0].url,o)}))}else if(e[0]instanceof ee){const[t]=e;if(a=e[1],void 0===a&&(a=Jt),"function"!=typeof a)return l.call(this,"cb must be a function",o);this.bitmap={data:Zt.from(t.bitmap.data),width:t.bitmap.width,height:t.bitmap.height},this._quality=t._quality,this._deflateLevel=t._deflateLevel,this._deflateStrategy=t._deflateStrategy,this._filterType=t._filterType,this._rgba=t._rgba,this._background=t._background,this._originalMime=t._originalMime,o(null,this)}else if((s=e[0])&&"object"==typeof s&&"number"==typeof s.width&&"number"==typeof s.height&&(Zt.isBuffer(s.data)||s.data instanceof Uint8Array||"function"==typeof Uint8ClampedArray&&s.data instanceof Uint8ClampedArray)&&(s.data.length===s.width*s.height*4||s.data.length===s.width*s.height*3)){const[t]=e;a=e[1]||Jt;const r=t.width*t.height*4===t.data.length?Zt.from(t.data):function(t){if(t.length%3!=0)throw new Error("Buffer length is incorrect");const e=Zt.allocUnsafe(t.length/3*4);let r=0;for(let i=0;i<t.length;i++)e[r]=t[i],(i+1)%3==0&&(e[++r]=255),r++;return e}(t.data);this.bitmap={data:r,width:t.width,height:t.height},o(null,this)}else if("string"==typeof e[0]){const t=e[0];if(a=e[1],void 0===a&&(a=Jt),"function"!=typeof a)return l.call(this,"cb must be a function",o);!function(t,e){i()&&"function"==typeof i().readFile&&!t.match(/^(http|ftp)s?:\/\/./)?i().readFile(t,e):$t({url:t},e)}(t,((e,r)=>{if(e)return l.call(this,e,o);this.parseBitmap(r,t,o)}))}else if("object"==typeof e[0]&&Zt.isBuffer(e[0])){const t=e[0];if(a=e[1],"function"!=typeof a)return l.call(this,"cb must be a function",o);this.parseBitmap(t,null,o)}else{a=e[e.length-1],"function"!=typeof a&&(a=e[e.length-2],"function"!=typeof a&&(a=Jt));const t=ee.__extraConstructors.find((t=>t.test(...e)));if(!t)return l.call(this,"No matching constructor overloading was found. Please see the docs for how to call the Jimp constructor.",o);new Promise(((r,i)=>{t.run.call(this,r,i,...e)})).then((()=>o(null,this))).catch(o)}var s}parseBitmap(t,e,r){Ht.call(this,t,null,r)}rgba(t,e){return"boolean"!=typeof t?l.call(this,"bool must be a boolean, true for RGBA or false for RGB",e):(this._rgba=t,h(e)&&e.call(this,null,this),this)}emitMulti(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};r=Object.assign(r,{methodName:t,eventName:e}),this.emit("any",r),t&&this.emit(t,r),this.emit(e,r)}emitError(t,e){this.emitMulti(t,"error",e)}getHeight(){return this.bitmap.height}getWidth(){return this.bitmap.width}inspect(){return"<Jimp "+(this.bitmap===te?"pending...":this.bitmap.width+"x"+this.bitmap.height)+">"}toString(){return"[object Jimp]"}getMIME(){return this._originalMime||ee.MIME_PNG}getExtension(){const t=this.getMIME();return(Lt[t.toLowerCase()]||[])[0]}write(t,e){if(!i()||!i().createWriteStream)throw new Error("Cant access the filesystem. You can use the getBase64 method.");if("string"!=typeof t)return l.call(this,"path must be a string",e);if(void 0===e&&(e=Jt),"function"!=typeof e)return l.call(this,"cb must be a function",e);const r=Ut(t)||this.getMIME(),n=a().parse(t);return n.dir&&i().mkdirSync(n.dir,{recursive:!0}),this.getBuffer(r,((r,n)=>{if(r)return l.call(this,r,e);const a=i().createWriteStream(t);a.on("open",(()=>{a.write(n),a.end()})).on("error",(t=>l.call(this,t,e))),a.on("finish",(()=>{e.call(this,null,this)}))})),this}getBase64(t,e){return t===ee.AUTO&&(t=this.getMIME()),"string"!=typeof t?l.call(this,"mime must be a string",e):"function"!=typeof e?l.call(this,"cb must be a function",e):(this.getBuffer(t,(function(r,i){if(r)return l.call(this,r,e);const n="data:"+t+";base64,"+i.toString("base64");e.call(this,null,n)})),this)}hash(t,e){if("function"==typeof(t=t||64)&&(e=t,t=64),"number"!=typeof t)return l.call(this,"base must be a number",e);if(t<2||t>64)return l.call(this,"base must be a number between 2 and 64",e);let r=this.pHash();for(r=c()(c().BIN,Vt.slice(0,t))(r);r.length<Xt[t];)r="0"+r;return h(e)&&e.call(this,null,r),r}pHash(){return(new $).getHash(this)}distanceFromHash(t){const e=new $,r=e.getHash(this);return e.distance(r,t)}getPixelIndex(t,e,r,i){let n,a;if("function"==typeof r&&void 0===i&&(i=r,r=null),r||(r=ee.EDGE_EXTEND),"number"!=typeof t||"number"!=typeof e)return l.call(this,"x and y must be numbers",i);n=t=Math.round(t),a=e=Math.round(e),r===ee.EDGE_EXTEND&&(t<0&&(n=0),t>=this.bitmap.width&&(n=this.bitmap.width-1),e<0&&(a=0),e>=this.bitmap.height&&(a=this.bitmap.height-1)),r===ee.EDGE_WRAP&&(t<0&&(n=this.bitmap.width+t),t>=this.bitmap.width&&(n=t%this.bitmap.width),e<0&&(a=this.bitmap.height+e),e>=this.bitmap.height&&(a=e%this.bitmap.height));let o=this.bitmap.width*a+n<<2;return(n<0||n>=this.bitmap.width)&&(o=-1),(a<0||a>=this.bitmap.height)&&(o=-1),h(i)&&i.call(this,null,o),o}getPixelColor(t,e,r){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"x and y must be numbers",r);const i=this.getPixelIndex(t,e),n=this.bitmap.data.readUInt32BE(i);return h(r)&&r.call(this,null,n),n}setPixelColor(t,e,r,i){if("number"!=typeof t||"number"!=typeof e||"number"!=typeof r)return l.call(this,"hex, x and y must be numbers",i);const n=this.getPixelIndex(e,r);return this.bitmap.data.writeUInt32BE(t,n),h(i)&&i.call(this,null,this),this}hasAlpha(){const{width:t,height:e,data:r}=this.bitmap,i=t*e<<2;for(let t=3;t<i;t+=4)if(255!==r[t])return!0;return!1}scanIterator(t,e,r,i){return"number"!=typeof t||"number"!=typeof e?l.call(this,"x and y must be numbers"):"number"!=typeof r||"number"!=typeof i?l.call(this,"w and h must be numbers"):function*(t,e,r,i,n){e=Math.round(e),r=Math.round(r),i=Math.round(i),n=Math.round(n);for(let a=r;a<r+n;a++)for(let r=e;r<e+i;r++){const e=t.bitmap.width*a+r<<2;yield{x:r,y:a,idx:e,image:t}}}(this,t,e,r,i)}}function re(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:ee;Object.entries(t).forEach((t=>{let[r,i]=t;e[r]=i}))}function ie(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:ee;Object.entries(t).forEach((t=>{let[r,i]=t;e.prototype[r]=i}))}function ne(t,e,r){const i="before-"+e,n=e.replace(/e$/,"")+"ed";ee.prototype[t]=function(){let e;for(var a=arguments.length,o=new Array(a),s=0;s<a;s++)o[s]=arguments[s];const h=o[r.length-1],l=this;let f;"function"==typeof h?(e=function(){for(var e=arguments.length,r=new Array(e),i=0;i<e;i++)r[i]=arguments[i];const[a,o]=r;a?l.emitError(t,a):l.emitMulti(t,n,{[t]:o}),h.apply(this,r)},o[o.length-1]=e):e=!1,this.emitMulti(t,i);try{f=r.apply(this,o),e||this.emitMulti(t,n,{[t]:f})}catch(e){e.methodName=t,this.emitError(t,e)}return f},ee.prototype[t+"Quiet"]=r}function ae(t,e){ne(t,"change",e)}re(t),ie({composite:function(t,r,i){let n=arguments.length>3&&void 0!==arguments[3]?arguments[3]:{},a=arguments.length>4?arguments[4]:void 0;if("function"==typeof n&&(a=n,n={}),!(t instanceof this.constructor))return l.call(this,"The source must be a Jimp image",a);if("number"!=typeof r||"number"!=typeof i)return l.call(this,"x and y must be numbers",a);let{mode:o,opacitySource:s,opacityDest:f}=n;o||(o=ht),("number"!=typeof s||s<0||s>1)&&(s=1),("number"!=typeof f||f<0||f>1)&&(f=1);const u=e[o];r=Math.round(r),i=Math.round(i);const c=this;return 1!==f&&c.opacity(f),t.scanQuiet(0,0,t.bitmap.width,t.bitmap.height,(function(t,e,n){const a=c.getPixelIndex(r+t,i+e,vt);if(-1===a)return;const o=u({r:this.bitmap.data[n+0]/255,g:this.bitmap.data[n+1]/255,b:this.bitmap.data[n+2]/255,a:this.bitmap.data[n+3]/255},{r:c.bitmap.data[a+0]/255,g:c.bitmap.data[a+1]/255,b:c.bitmap.data[a+2]/255,a:c.bitmap.data[a+3]/255},s);c.bitmap.data[a+0]=this.constructor.limit255(255*o.r),c.bitmap.data[a+1]=this.constructor.limit255(255*o.g),c.bitmap.data[a+2]=this.constructor.limit255(255*o.b),c.bitmap.data[a+3]=this.constructor.limit255(255*o.a)})),h(a)&&a.call(this,null,this),this}}),ee.__extraConstructors=[],ee.appendConstructorOption=function(t,e,r){ee.__extraConstructors.push({name:t,test:e,run:r})},ee.read=function(){for(var t=arguments.length,e=new Array(t),r=0;r<t;r++)e[r]=arguments[r];return new Promise(((t,r)=>{new ee(...e,((e,i)=>{e?r(e):t(i)}))}))},ee.create=ee.read,ee.rgbaToInt=function(t,e,r,i,n){if("number"!=typeof t||"number"!=typeof e||"number"!=typeof r||"number"!=typeof i)return l.call(this,"r, g, b and a must be numbers",n);if(t<0||t>255)return l.call(this,"r must be between 0 and 255",n);if((e<0||e>255)&&l.call(this,"g must be between 0 and 255",n),r<0||r>255)return l.call(this,"b must be between 0 and 255",n);if(i<0||i>255)return l.call(this,"a must be between 0 and 255",n);let a=255&t;return a<<=8,a|=255&e,a<<=8,a|=255&r,a<<=8,a|=255&i,a>>>=0,h(n)&&n.call(this,null,a),a},ee.intToRGBA=function(t,e){if("number"!=typeof t)return l.call(this,"i must be a number",e);const r={};return r.r=Math.floor(t/Math.pow(256,3)),r.g=Math.floor((t-r.r*Math.pow(256,3))/Math.pow(256,2)),r.b=Math.floor((t-r.r*Math.pow(256,3)-r.g*Math.pow(256,2))/Math.pow(256,1)),r.a=Math.floor((t-r.r*Math.pow(256,3)-r.g*Math.pow(256,2)-r.b*Math.pow(256,1))/Math.pow(256,0)),h(e)&&e.call(this,null,r),r},ee.cssColorToHex=function(t){return"number"==typeof(t=t||0)?Number(t):parseInt(_(t).toHex8(),16)},ee.limit255=function(t){return t=Math.max(t,0),Math.min(t,255)},ee.diff=function(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:.1;if(!(t instanceof ee&&e instanceof ee))return l.call(this,"img1 and img2 must be an Jimp images");const i=t.bitmap,n=e.bitmap;if(i.width===n.width&&i.height===n.height||(i.width*i.height>n.width*n.height?t=t.cloneQuiet().resize(n.width,n.height):e=e.cloneQuiet().resize(i.width,i.height)),"number"!=typeof r||r<0||r>1)return l.call(this,"threshold must be a number between 0 and 1");const a=new ee(i.width,i.height,4294967295);return{percent:p()(i.data,n.data,a.bitmap.data,a.bitmap.width,a.bitmap.height,{threshold:r})/(a.bitmap.width*a.bitmap.height),image:a}},ee.distance=function(t,e){const r=new $,i=r.getHash(t),n=r.getHash(e);return r.distance(i,n)},ee.compareHashes=function(t,e){return(new $).distance(t,e)},ee.colorDiff=function(t,e){const r=t=>Math.pow(t,2),{max:i}=Math;return 0===t.a||t.a||(t.a=255),0===e.a||e.a||(e.a=255),(i(r(t.r-e.r),r(t.r-e.r-t.a+e.a))+i(r(t.g-e.g),r(t.g-e.g-t.a+e.a))+i(r(t.b-e.b),r(t.b-e.b-t.a+e.a)))/195075},ne("clone","clone",(function(t){const e=new ee(this);return h(t)&&t.call(e,null,e),e})),ae("background",(function(t,e){return"number"!=typeof t?l.call(this,"hex must be a hexadecimal rgba value",e):(this._background=t,h(e)&&e.call(this,null,this),this)})),ae("scan",(function(t,e,r,i,n,a){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"x and y must be numbers",a);if("number"!=typeof r||"number"!=typeof i)return l.call(this,"w and h must be numbers",a);if("function"!=typeof n)return l.call(this,"f must be a function",a);const o=f(this,t,e,r,i,n);return h(a)&&a.call(this,null,o),o}));{let t;"undefined"!=typeof window&&"object"==typeof window&&(t=window),"undefined"!=typeof self&&"object"==typeof self&&(t=self),t.Jimp=ee,t.Buffer=Zt}const oe=ee;var se=__webpack_require__(643),he=__webpack_require__(2691),le=__webpack_require__.n(he);const fe="image/jpeg",ue=()=>({mime:{[fe]:["jpeg","jpg","jpe"]},constants:{MIME_JPEG:fe},decoders:{[fe]:le().decode},encoders:{[fe]:t=>le().encode(t.bitmap,t._quality).data},class:{_quality:100,quality(t,e){return"number"!=typeof t?l.call(this,"n must be a number",e):t<0||t>100?l.call(this,"n must be a number 0 - 100",e):(this._quality=Math.round(t),h(e)&&e.call(this,null,this),this)}}});var ce=__webpack_require__(9902);const de="image/png",pe=()=>({mime:{[de]:["png"]},constants:{MIME_PNG:de,PNG_FILTER_AUTO:-1,PNG_FILTER_NONE:0,PNG_FILTER_SUB:1,PNG_FILTER_UP:2,PNG_FILTER_AVERAGE:3,PNG_FILTER_PATH:4},hasAlpha:{[de]:!0},decoders:{[de]:ce.PNG.sync.read},encoders:{[de](t){const e=new ce.PNG({width:t.bitmap.width,height:t.bitmap.height});return e.data=t.bitmap.data,ce.PNG.sync.write(e,{deflateLevel:t._deflateLevel,deflateStrategy:t._deflateStrategy,filterType:t._filterType,colorType:"number"==typeof t._colorType?t._colorType:t._rgba?6:2,inputHasAlpha:t._rgba})}},class:{_deflateLevel:9,_deflateStrategy:3,_filterType:-1,_colorType:null,deflateLevel(t,e){return"number"!=typeof t?l.call(this,"l must be a number",e):t<0||t>9?l.call(this,"l must be a number 0 - 9",e):(this._deflateLevel=Math.round(t),h(e)&&e.call(this,null,this),this)},deflateStrategy(t,e){return"number"!=typeof t?l.call(this,"s must be a number",e):t<0||t>3?l.call(this,"s must be a number 0 - 3",e):(this._deflateStrategy=Math.round(t),h(e)&&e.call(this,null,this),this)},filterType(t,e){return"number"!=typeof t?l.call(this,"n must be a number",e):t<-1||t>4?l.call(this,"n must be -1 (auto) or a number 0 - 4",e):(this._filterType=Math.round(t),h(e)&&e.call(this,null,this),this)},colorType(t,e){return"number"!=typeof t?l.call(this,"s must be a number",e):0!==t&&2!==t&&4!==t&&6!==t?l.call(this,"s must be a number 0, 2, 4, 6.",e):(this._colorType=Math.round(t),h(e)&&e.call(this,null,this),this)}}});var me=__webpack_require__(486),ge=__webpack_require__.n(me);const be="image/bmp",_e="image/x-ms-bmp",ye=t=>{return f({bitmap:e=ge().decode(t)},0,0,e.width,e.height,(function(t,r,i){const n=this.bitmap.data[i+0],a=this.bitmap.data[i+1],o=this.bitmap.data[i+2],s=this.bitmap.data[i+3];this.bitmap.data[i+0]=s,this.bitmap.data[i+1]=o,this.bitmap.data[i+2]=a,this.bitmap.data[i+3]=e.is_with_alpha?n:255})).bitmap;var e},we=t=>ge().encode(function(t){return f(t,0,0,t.bitmap.width,t.bitmap.height,(function(t,e,r){const i=this.bitmap.data[r+0],n=this.bitmap.data[r+1],a=this.bitmap.data[r+2],o=this.bitmap.data[r+3];this.bitmap.data[r+0]=o,this.bitmap.data[r+1]=a,this.bitmap.data[r+2]=n,this.bitmap.data[r+3]=i})).bitmap}(t)).data;var ve=__webpack_require__(9299),xe=__webpack_require__.n(ve),Ee=__webpack_require__(8834).lW;const ke="image/tiff";var Se=__webpack_require__(63),Me=__webpack_require__(9455),Ae=__webpack_require__(8834).lW;const Ie="image/gif",Be=[1,57,41,21,203,34,97,73,227,91,149,62,105,45,39,137,241,107,3,173,39,71,65,238,219,101,187,87,81,151,141,133,249,117,221,209,197,187,177,169,5,153,73,139,133,127,243,233,223,107,103,99,191,23,177,171,165,159,77,149,9,139,135,131,253,245,119,231,224,109,211,103,25,195,189,23,45,175,171,83,81,79,155,151,147,9,141,137,67,131,129,251,123,30,235,115,113,221,217,53,13,51,50,49,193,189,185,91,179,175,43,169,83,163,5,79,155,19,75,147,145,143,35,69,17,67,33,65,255,251,247,243,239,59,29,229,113,111,219,27,213,105,207,51,201,199,49,193,191,47,93,183,181,179,11,87,43,85,167,165,163,161,159,157,155,77,19,75,37,73,145,143,141,35,138,137,135,67,33,131,129,255,63,250,247,61,121,239,237,117,29,229,227,225,111,55,109,216,213,211,209,207,205,203,201,199,197,195,193,48,190,47,93,185,183,181,179,178,176,175,173,171,85,21,167,165,41,163,161,5,79,157,78,154,153,19,75,149,74,147,73,144,143,71,141,140,139,137,17,135,134,133,66,131,65,129,1],Te=[0,9,10,10,14,12,14,14,16,15,16,15,16,15,15,17,18,17,12,18,16,17,17,19,19,18,19,18,18,19,19,19,20,19,20,20,20,20,20,20,15,20,19,20,20,20,21,21,21,20,20,20,21,18,21,21,21,21,20,21,17,21,21,21,22,22,21,22,22,21,22,21,19,22,22,19,20,22,22,21,21,21,22,22,22,18,22,22,21,22,22,23,22,20,23,22,22,23,23,21,19,21,21,21,23,23,23,22,23,23,21,23,22,23,18,22,23,20,22,23,23,23,21,22,20,22,21,22,24,24,24,24,24,22,21,24,23,23,24,21,24,23,24,22,24,24,22,24,24,22,23,24,24,24,20,23,22,23,24,24,24,24,24,24,24,23,21,23,22,23,24,24,24,22,24,24,24,23,22,24,24,25,23,25,25,23,24,25,25,24,22,25,25,25,24,23,24,25,25,25,25,25,25,25,25,25,25,25,25,23,25,23,24,25,25,25,25,25,25,25,25,25,24,22,25,25,23,25,25,20,24,25,24,25,25,22,24,25,24,25,24,25,25,24,25,25,25,25,22,25,25,25,24,25,24,25,18];var Re=__webpack_require__(8834).lW;function Pe(t,e,r,i){const n=[0,0,0],a=(e.length-1)/2;for(let o=0;o<e.length;o+=1)for(let s=0;s<e[o].length;s+=1){const h=t.getPixelIndex(r+o-a,i+s-a);n[0]+=t.bitmap.data[h]*e[o][s],n[1]+=t.bitmap.data[h+1]*e[o][s],n[2]+=t.bitmap.data[h+2]*e[o][s]}return n}const Oe=t=>null!=t;function Le(t){return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){const i=parseInt(.2126*this.bitmap.data[r]+.7152*this.bitmap.data[r+1]+.0722*this.bitmap.data[r+2],10);this.bitmap.data[r]=i,this.bitmap.data[r+1]=i,this.bitmap.data[r+2]=i})),h(t)&&t.call(this,null,this),this}function Ce(t,e){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:50;return{r:(e.r-t.r)*(r/100)+t.r,g:(e.g-t.g)*(r/100)+t.g,b:(e.b-t.b)*(r/100)+t.b}}function Ue(t,e){return t&&Array.isArray(t)?(t=t.map((t=>("xor"!==t.apply&&"mix"!==t.apply||(t.params[0]=_(t.params[0]).toRgb()),t))),this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,((r,i,n)=>{let a={r:this.bitmap.data[n],g:this.bitmap.data[n+1],b:this.bitmap.data[n+2]};const o=(t,e)=>this.constructor.limit255(a[t]+e);t.forEach((t=>{if("mix"===t.apply)a=Ce(a,t.params[0],t.params[1]);else if("tint"===t.apply)a=Ce(a,{r:255,g:255,b:255},t.params[0]);else if("shade"===t.apply)a=Ce(a,{r:0,g:0,b:0},t.params[0]);else if("xor"===t.apply)a={r:a.r^t.params[0].r,g:a.g^t.params[0].g,b:a.b^t.params[0].b};else if("red"===t.apply)a.r=o("r",t.params[0]);else if("green"===t.apply)a.g=o("g",t.params[0]);else if("blue"===t.apply)a.b=o("b",t.params[0]);else{if("hue"===t.apply&&(t.apply="spin"),a=_(a),!a[t.apply])return l.call(this,"action "+t.apply+" not supported",e);a=a[t.apply](...t.params).toRgb()}})),this.bitmap.data[n]=a.r,this.bitmap.data[n+1]=a.g,this.bitmap.data[n+2]=a.b})),h(e)&&e.call(this,null,this),this):l.call(this,"actions must be an array",e)}Object.freeze({LIGHTEN:"lighten",BRIGHTEN:"brighten",DARKEN:"darken",DESATURATE:"desaturate",SATURATE:"saturate",GREYSCALE:"greyscale",SPIN:"spin",HUE:"hue",MIX:"mix",TINT:"tint",SHADE:"shade",XOR:"xor",RED:"red",GREEN:"green",BLUE:"blue"});var ze=__webpack_require__(8834).lW;function De(t){const e=[1,9,3,11,13,5,15,7,4,12,2,10,16,8,14,6];return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,r,i){const n=e[((3&r)<<2)+t%4];this.bitmap.data[i]=Math.min(this.bitmap.data[i]+n,255),this.bitmap.data[i+1]=Math.min(this.bitmap.data[i+1]+n,255),this.bitmap.data[i+2]=Math.min(this.bitmap.data[i+2]+n,255)})),h(t)&&t.call(this,null,this),this}var Ne=__webpack_require__(8834).lW;function Fe(t,e,r){if("boolean"!=typeof t||"boolean"!=typeof e)return l.call(this,"horizontal and vertical must be Booleans",r);const i=Ne.alloc(this.bitmap.data.length);return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(r,n,a){const o=t?this.bitmap.width-1-r:r,s=e?this.bitmap.height-1-n:n,h=this.bitmap.width*s+o<<2,l=this.bitmap.data.readUInt32BE(a);i.writeUInt32BE(l,h)})),this.bitmap.data=Ne.from(i),h(r)&&r.call(this,null,this),this}function je(){const t={r:new Array(256).fill(0),g:new Array(256).fill(0),b:new Array(256).fill(0)};return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(e,r,i){t.r[this.bitmap.data[i+0]]++,t.g[this.bitmap.data[i+1]]++,t.b[this.bitmap.data[i+2]]++})),t}const Ge=function(t,e,r){return 255*(t-e)/(r-e)},He=function(t){return[t.findIndex((t=>t>0)),255-t.slice().reverse().findIndex((t=>t>0))]};var We=__webpack_require__(8058),qe=__webpack_require__.n(We);function Ze(t,e){let r=0;for(let i=0;i<e.length;i++)if(t.chars[e[i]]){const n=t.kernings[e[i]]&&t.kernings[e[i]][e[i+1]]?t.kernings[e[i]][e[i+1]]:0;r+=(t.chars[e[i]].xadvance||0)+n}return r}function Ye(t,e,r){const i=e.replace(/[\r\n]+/g," \n").split(" "),n=[];let a=[],o=0;return i.forEach((e=>{const i=[...a,e].join(" "),s=Ze(t,i);s<=r&&!e.includes("\n")?(s>o&&(o=s),a.push(e)):(n.push(a),a=[e.replace("\n","")])})),n.push(a),{lines:n,longestLine:o}}function Ve(t,e,r){const{lines:i}=Ye(t,e,r);return i.length*t.common.lineHeight}function Xe(t,e,r,i,n){if(n.width>0&&n.height>0){const a=e.pages[n.page];t.blit(a,r+n.xoffset,i+n.yoffset,n.x,n.y,n.width,n.height)}return t}function Je(t,e,r,i,n){for(let a=0;a<i.length;a++){let o;o=t.chars[i[a]]?i[a]:/\s/.test(i[a])?"":"?";const s=t.chars[o]||{},h=t.kernings[o];Xe(this,t,e,r,s||{}),e+=(h&&h[i[a+1]]?h[i[a+1]]:0)+(s.xadvance||n)}}const Qe="//../";function Ke(t,e,r,i,n,a,o){this.widthOriginal=Math.abs(Math.floor(t)||0),this.heightOriginal=Math.abs(Math.floor(e)||0),this.targetWidth=Math.abs(Math.floor(r)||0),this.targetHeight=Math.abs(Math.floor(i)||0),this.colorChannels=n?4:3,this.interpolationPass=Boolean(a),this.resizeCallback="function"==typeof o?o:function(){},this.targetWidthMultipliedByChannels=this.targetWidth*this.colorChannels,this.originalWidthMultipliedByChannels=this.widthOriginal*this.colorChannels,this.originalHeightMultipliedByChannels=this.heightOriginal*this.colorChannels,this.widthPassResultSize=this.targetWidthMultipliedByChannels*this.heightOriginal,this.finalResultSize=this.targetWidthMultipliedByChannels*this.targetHeight,this.initialize()}Ke.prototype.initialize=function(){if(!(this.widthOriginal>0&&this.heightOriginal>0&&this.targetWidth>0&&this.targetHeight>0))throw new Error("Invalid settings specified for the resizer.");this.configurePasses()},Ke.prototype.configurePasses=function(){this.widthOriginal===this.targetWidth?this.resizeWidth=this.bypassResizer:(this.ratioWeightWidthPass=this.widthOriginal/this.targetWidth,this.ratioWeightWidthPass<1&&this.interpolationPass?(this.initializeFirstPassBuffers(!0),this.resizeWidth=4===this.colorChannels?this.resizeWidthInterpolatedRGBA:this.resizeWidthInterpolatedRGB):(this.initializeFirstPassBuffers(!1),this.resizeWidth=4===this.colorChannels?this.resizeWidthRGBA:this.resizeWidthRGB)),this.heightOriginal===this.targetHeight?this.resizeHeight=this.bypassResizer:(this.ratioWeightHeightPass=this.heightOriginal/this.targetHeight,this.ratioWeightHeightPass<1&&this.interpolationPass?(this.initializeSecondPassBuffers(!0),this.resizeHeight=this.resizeHeightInterpolated):(this.initializeSecondPassBuffers(!1),this.resizeHeight=4===this.colorChannels?this.resizeHeightRGBA:this.resizeHeightRGB))},Ke.prototype._resizeWidthInterpolatedRGBChannels=function(t,e){const r=e?4:3,i=this.ratioWeightWidthPass,n=this.widthBuffer;let a,o,s=0,h=0,l=0,f=0,u=0;for(a=0;s<1/3;a+=r,s+=i)for(h=a,l=0;h<this.widthPassResultSize;l+=this.originalWidthMultipliedByChannels,h+=this.targetWidthMultipliedByChannels)n[h]=t[l],n[h+1]=t[l+1],n[h+2]=t[l+2],e&&(n[h+3]=t[l+3]);for(s-=1/3,o=this.widthOriginal-1;s<o;a+=r,s+=i)for(u=s%1,f=1-u,h=a,l=Math.floor(s)*r;h<this.widthPassResultSize;l+=this.originalWidthMultipliedByChannels,h+=this.targetWidthMultipliedByChannels)n[h+0]=t[l+0]*f+t[l+r+0]*u,n[h+1]=t[l+1]*f+t[l+r+1]*u,n[h+2]=t[l+2]*f+t[l+r+2]*u,e&&(n[h+3]=t[l+3]*f+t[l+r+3]*u);for(o=this.originalWidthMultipliedByChannels-r;a<this.targetWidthMultipliedByChannels;a+=r)for(h=a,l=o;h<this.widthPassResultSize;l+=this.originalWidthMultipliedByChannels,h+=this.targetWidthMultipliedByChannels)n[h]=t[l],n[h+1]=t[l+1],n[h+2]=t[l+2],e&&(n[h+3]=t[l+3]);return n},Ke.prototype._resizeWidthRGBChannels=function(t,e){const r=e?4:3,i=this.ratioWeightWidthPass,n=1/i,a=this.originalWidthMultipliedByChannels-r+1,o=this.targetWidthMultipliedByChannels-r+1,s=this.outputWidthWorkBench,h=this.widthBuffer,l=this.outputWidthWorkBenchOpaquePixelsCount;let f=0,u=0,c=0,d=0,p=0,m=0,g=0,b=1,_=0,y=0,w=0,v=0;do{for(p=0;p<this.originalHeightMultipliedByChannels;)s[p++]=0,s[p++]=0,s[p++]=0,e&&(s[p++]=0,l[p/r-1]=0);f=i;do{for(u=1+c-d,b=Math.min(f,u),p=0,m=c;p<this.originalHeightMultipliedByChannels;m+=a)_=t[m],y=t[++m],w=t[++m],v=e?t[++m]:255,s[p++]+=(v?_:0)*b,s[p++]+=(v?y:0)*b,s[p++]+=(v?w:0)*b,e&&(s[p++]+=v*b,l[p/r-1]+=v?b:0);if(!(f>=u)){d+=f;break}c+=r,d=c,f-=u}while(f>0&&c<this.originalWidthMultipliedByChannels);for(p=0,m=g;p<this.originalHeightMultipliedByChannels;m+=o)f=e?l[p/r]:1,b=e?f?1/f:0:n,h[m]=s[p++]*b,h[++m]=s[p++]*b,h[++m]=s[p++]*b,e&&(h[++m]=s[p++]*n);g+=r}while(g<this.targetWidthMultipliedByChannels);return h},Ke.prototype._resizeHeightRGBChannels=function(t,e){const r=this.ratioWeightHeightPass,i=1/r,n=this.outputHeightWorkBench,a=this.heightBuffer,o=this.outputHeightWorkBenchOpaquePixelsCount;let s=0,h=0,l=0,f=0,u=0,c=0,d=0,p=1,m=0,g=0,b=0,_=0;do{for(u=0;u<this.targetWidthMultipliedByChannels;)n[u++]=0,n[u++]=0,n[u++]=0,e&&(n[u++]=0,o[u/4-1]=0);s=r;do{for(h=1+l-f,p=Math.min(s,h),d=l,u=0;u<this.targetWidthMultipliedByChannels;)m=t[d++],g=t[d++],b=t[d++],_=e?t[d++]:255,n[u++]+=(_?m:0)*p,n[u++]+=(_?g:0)*p,n[u++]+=(_?b:0)*p,e&&(n[u++]+=_*p,o[u/4-1]+=_?p:0);if(!(s>=h)){f+=s;break}l=d,f=l,s-=h}while(s>0&&l<this.widthPassResultSize);for(u=0;u<this.targetWidthMultipliedByChannels;)s=e?o[u/4]:1,p=e?s?1/s:0:i,a[c++]=Math.round(n[u++]*p),a[c++]=Math.round(n[u++]*p),a[c++]=Math.round(n[u++]*p),e&&(a[c++]=Math.round(n[u++]*i))}while(c<this.finalResultSize);return a},Ke.prototype.resizeWidthInterpolatedRGB=function(t){return this._resizeWidthInterpolatedRGBChannels(t,!1)},Ke.prototype.resizeWidthInterpolatedRGBA=function(t){return this._resizeWidthInterpolatedRGBChannels(t,!0)},Ke.prototype.resizeWidthRGB=function(t){return this._resizeWidthRGBChannels(t,!1)},Ke.prototype.resizeWidthRGBA=function(t){return this._resizeWidthRGBChannels(t,!0)},Ke.prototype.resizeHeightInterpolated=function(t){const e=this.ratioWeightHeightPass,r=this.heightBuffer;let i,n=0,a=0,o=0,s=0,h=0,l=0,f=0;for(;n<1/3;n+=e)for(o=0;o<this.targetWidthMultipliedByChannels;)r[a++]=Math.round(t[o++]);for(n-=1/3,i=this.heightOriginal-1;n<i;n+=e)for(f=n%1,l=1-f,s=Math.floor(n)*this.targetWidthMultipliedByChannels,h=s+this.targetWidthMultipliedByChannels,o=0;o<this.targetWidthMultipliedByChannels;++o)r[a++]=Math.round(t[s++]*l+t[h++]*f);for(;a<this.finalResultSize;)for(o=0,s=i*this.targetWidthMultipliedByChannels;o<this.targetWidthMultipliedByChannels;++o)r[a++]=Math.round(t[s++]);return r},Ke.prototype.resizeHeightRGB=function(t){return this._resizeHeightRGBChannels(t,!1)},Ke.prototype.resizeHeightRGBA=function(t){return this._resizeHeightRGBChannels(t,!0)},Ke.prototype.resize=function(t){this.resizeCallback(this.resizeHeight(this.resizeWidth(t)))},Ke.prototype.bypassResizer=function(t){return t},Ke.prototype.initializeFirstPassBuffers=function(t){this.widthBuffer=this.generateFloatBuffer(this.widthPassResultSize),t||(this.outputWidthWorkBench=this.generateFloatBuffer(this.originalHeightMultipliedByChannels),this.colorChannels>3&&(this.outputWidthWorkBenchOpaquePixelsCount=this.generateFloat64Buffer(this.heightOriginal)))},Ke.prototype.initializeSecondPassBuffers=function(t){this.heightBuffer=this.generateUint8Buffer(this.finalResultSize),t||(this.outputHeightWorkBench=this.generateFloatBuffer(this.targetWidthMultipliedByChannels),this.colorChannels>3&&(this.outputHeightWorkBenchOpaquePixelsCount=this.generateFloat64Buffer(this.targetWidth)))},Ke.prototype.generateFloatBuffer=function(t){try{return new Float32Array(t)}catch(t){return[]}},Ke.prototype.generateFloat64Buffer=function(t){try{return new Float64Array(t)}catch(t){return[]}},Ke.prototype.generateUint8Buffer=function(t){try{return new Uint8Array(t)}catch(t){return[]}};const $e=Ke;var tr=__webpack_require__(8834).lW;const er={nearestNeighbor(t,e){const r=t.width,i=t.height,n=e.width,a=e.height,o=t.data,s=e.data;for(let t=0;t<a;t++)for(let e=0;e<n;e++){let h=4*(t*n+e),l=4*(Math.floor(t*i/a)*r+Math.floor(e*r/n));s[h++]=o[l++],s[h++]=o[l++],s[h++]=o[l++],s[h++]=o[l++]}},bilinearInterpolation(t,e){const r=t.width,i=t.height,n=e.width,a=e.height,o=t.data,s=e.data,h=function(t,e,r,i,n){return e===i?r:Math.round((t-e)*n+(i-t)*r)},l=function(t,e,i,n,a,l,f,u){let c=4*(f*r+n)+e,d=4*(f*r+a)+e;const p=h(i,n,o[c],a,o[d]);if(u===f)s[t+e]=p;else{c=4*(u*r+n)+e,d=4*(u*r+a)+e;const m=h(i,n,o[c],a,o[d]);s[t+e]=h(l,f,p,u,m)}};for(let t=0;t<a;t++)for(let e=0;e<n;e++){const o=4*(t*n+e),s=e*r/n,h=Math.floor(s),f=Math.min(Math.ceil(s),r-1),u=t*i/a,c=Math.floor(u),d=Math.min(Math.ceil(u),i-1);l(o,0,s,h,f,u,c,d),l(o,1,s,h,f,u,c,d),l(o,2,s,h,f,u,c,d),l(o,3,s,h,f,u,c,d)}},_interpolate2D(t,e,r,i){const n=t.data,a=e.data,o=t.width,s=t.height,h=e.width,l=e.height,f=Math.max(1,Math.floor(o/h)),u=h*f,c=Math.max(1,Math.floor(s/l)),d=l*c,p=tr.alloc(u*s*4);for(let t=0;t<s;t++)for(let e=0;e<u;e++){const r=e*(o-1)/u,a=Math.floor(r),s=r-a,h=4*(t*o+a),l=4*(t*u+e);for(let t=0;t<4;t++){const e=h+t,r=a>0?n[e-4]:2*n[e]-n[e+4],f=n[e],u=n[e+4],c=a<o-2?n[e+8]:2*n[e+4]-n[e];p[l+t]=i(r,f,u,c,s)}}const m=tr.alloc(u*d*4);for(let t=0;t<d;t++)for(let e=0;e<u;e++){const r=t*(s-1)/d,n=Math.floor(r),a=r-n,o=4*(n*u+e),h=4*(t*u+e);for(let t=0;t<4;t++){const e=o+t,r=n>0?p[e-4*u]:2*p[e]-p[e+4*u],l=p[e],f=p[e+4*u],c=n<s-2?p[e+8*u]:2*p[e+4*u]-p[e];m[h+t]=i(r,l,f,c,a)}}const g=f*c;if(g>1)for(let t=0;t<l;t++)for(let e=0;e<h;e++){let r=0,i=0,n=0,o=0,s=0;for(let a=0;a<c;a++){const h=t*c+a;for(let t=0;t<f;t++){const a=4*(h*u+(e*f+t)),l=m[a+3];l&&(r+=m[a],i+=m[a+1],n+=m[a+2],s++),o+=l}}const l=4*(t*h+e);a[l]=s?Math.round(r/s):0,a[l+1]=s?Math.round(i/s):0,a[l+2]=s?Math.round(n/s):0,a[l+3]=Math.round(o/g)}else e.data=m},bicubicInterpolation(t,e,r){return this._interpolate2D(t,e,r,(function(t,e,r,i,n){const a=i-r-t+e,o=t-e-a,s=r-t,h=e;return Math.max(0,Math.min(255,a*(n*n*n)+o*(n*n)+s*n+h))}))},hermiteInterpolation(t,e,r){return this._interpolate2D(t,e,r,(function(t,e,r,i,n){const a=e,o=.5*(r-t),s=t-2.5*e+2*r-.5*i,h=.5*(i-t)+1.5*(e-r);return Math.max(0,Math.min(255,Math.round(((h*n+s)*n+o)*n+a)))}))},bezierInterpolation(t,e,r){return this._interpolate2D(t,e,r,(function(t,e,r,i,n){const a=1-n,o=e*a*a*a,s=3*(e+(r-t)/4)*a*a*n,h=3*(r-(i-e)/4)*a*n*n,l=r*n*n*n;return Math.max(0,Math.min(255,Math.round(o+s+h+l)))}))}},rr=er;var ir=__webpack_require__(8834).lW,nr=__webpack_require__(8834).lW;function ar(t){if(Math.abs(t)%90!=0)throw new Error("Unsupported matrix rotation degree");if(t%=360,0===Math.abs(t))return;const e=this.bitmap.width,r=this.bitmap.height;let i;switch(t){case 90:case-270:i=90;break;case 180:case-180:i=180;break;case 270:case-90:i=-90;break;default:throw new Error("Unsupported matrix rotation degree")}const n=180===i?e:r,a=180===i?r:e,o=nr.alloc(this.bitmap.data.length);function s(t,e){return function(e,r){return r*t+e<<2}}const h=s(e),l=s(n);for(let t=0;t<e;t++)for(let n=0;n<r;n++){const a=h(t,n),s=this.bitmap.data.readUInt32BE(a);let f;switch(i){case 90:f=l(n,e-t-1);break;case-90:f=l(r-n-1,t);break;case 180:f=l(e-t-1,r-n-1);break;default:throw new Error("Unsupported matrix rotation angle")}o.writeUInt32BE(s,f)}this.bitmap.data=o,this.bitmap.width=n,this.bitmap.height=a}function or(t,e){const r=(t%=360)*Math.PI/180,i=Math.cos(r),n=Math.sin(r);let a=this.bitmap.width,o=this.bitmap.height;if(!0===e||"string"==typeof e){a=Math.ceil(Math.abs(this.bitmap.width*i)+Math.abs(this.bitmap.height*n))+1,o=Math.ceil(Math.abs(this.bitmap.width*n)+Math.abs(this.bitmap.height*i))+1,a%2!=0&&a++,o%2!=0&&o++;const t=this.cloneQuiet();this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){this.bitmap.data.writeUInt32BE(this._background,r)}));const r=Math.max(a,o,this.bitmap.width,this.bitmap.height);this.resize(r,r,e),this.blit(t,this.bitmap.width/2-t.bitmap.width/2,this.bitmap.height/2-t.bitmap.height/2)}const s=this.bitmap.width,h=this.bitmap.height,l=nr.alloc(this.bitmap.data.length);function f(t,e){return function(r,i){return{x:r+t,y:i+e}}}const u=f(-s/2,-h/2),c=f(s/2+.5,h/2+.5);for(let t=1;t<=h;t++)for(let e=1;e<=s;e++){const r=u(e,t),a=c(i*r.x-n*r.y,i*r.y+n*r.x),o=s*(t-1)+e-1<<2;if(a.x>=0&&a.x<s&&a.y>=0&&a.y<h){const t=(s*(0|a.y)+a.x|0)<<2,e=this.bitmap.data.readUInt32BE(t);l.writeUInt32BE(e,o)}else l.writeUInt32BE(this._background,o)}if(this.bitmap.data=l,!0===e||"string"==typeof e){const t=s/2-a/2,e=h/2-o/2;this.crop(t,e,a,o)}}const sr=[()=>({blit(t,e,r,i,n,a,o,s){if(!(t instanceof this.constructor))return l.call(this,"The source must be a Jimp image",s);if("number"!=typeof e||"number"!=typeof r)return l.call(this,"x and y must be numbers",s);if("function"==typeof i)s=i,i=0,n=0,a=t.bitmap.width,o=t.bitmap.height;else{if(typeof i!=typeof n||typeof n!=typeof a||typeof a!=typeof o)return l.call(this,"srcx, srcy, srcw, srch must be numbers",s);i=i||0,n=n||0,a=a||t.bitmap.width,o=o||t.bitmap.height}e=Math.round(e),r=Math.round(r),i=Math.round(i),n=Math.round(n),a=Math.round(a),o=Math.round(o);const f=this.bitmap.width,u=this.bitmap.height,c=this;return t.scanQuiet(i,n,a,o,(function(t,a,o){const s=e+t-i,h=r+a-n;if(s>=0&&h>=0&&f-s>0&&u-h>0){const t=c.getPixelIndex(s,h),e={r:this.bitmap.data[o],g:this.bitmap.data[o+1],b:this.bitmap.data[o+2],a:this.bitmap.data[o+3]},r={r:c.bitmap.data[t],g:c.bitmap.data[t+1],b:c.bitmap.data[t+2],a:c.bitmap.data[t+3]};c.bitmap.data[t]=(e.a*(e.r-r.r)-r.r+255>>8)+r.r,c.bitmap.data[t+1]=(e.a*(e.g-r.g)-r.g+255>>8)+r.g,c.bitmap.data[t+2]=(e.a*(e.b-r.b)-r.b+255>>8)+r.b,c.bitmap.data[t+3]=this.constructor.limit255(r.a+e.a)}})),h(s)&&s.call(this,null,this),this}}),()=>({blur(t,e){if("number"!=typeof t)return l.call(this,"r must be a number",e);if(t<1)return l.call(this,"r must be greater than 0",e);let r,i,n,a,o,s,f,u,c,d,p,m,g,b;const _=this.bitmap.width-1,y=this.bitmap.height-1,w=t+1,v=Be[t],x=Te[t],E=[],k=[],S=[],M=[],A=[],I=[];let B=2;for(;B-- >0;){for(m=0,g=0,s=0;s<this.bitmap.height;s++){for(r=this.bitmap.data[g]*w,i=this.bitmap.data[g+1]*w,n=this.bitmap.data[g+2]*w,a=this.bitmap.data[g+3]*w,f=1;f<=t;f++)u=g+((f>_?_:f)<<2),r+=this.bitmap.data[u++],i+=this.bitmap.data[u++],n+=this.bitmap.data[u++],a+=this.bitmap.data[u];for(o=0;o<this.bitmap.width;o++)E[m]=r,k[m]=i,S[m]=n,M[m]=a,0===s&&(A[o]=((u=o+w)<_?u:_)<<2,I[o]=(u=o-t)>0?u<<2:0),c=g+A[o],d=g+I[o],r+=this.bitmap.data[c++]-this.bitmap.data[d++],i+=this.bitmap.data[c++]-this.bitmap.data[d++],n+=this.bitmap.data[c++]-this.bitmap.data[d++],a+=this.bitmap.data[c]-this.bitmap.data[d],m++;g+=this.bitmap.width<<2}for(o=0;o<this.bitmap.width;o++){for(p=o,r=E[p]*w,i=k[p]*w,n=S[p]*w,a=M[p]*w,f=1;f<=t;f++)p+=f>y?0:this.bitmap.width,r+=E[p],i+=k[p],n+=S[p],a+=M[p];for(m=o<<2,s=0;s<this.bitmap.height;s++)b=a*v>>>x,this.bitmap.data[m+3]=b,b>255&&(this.bitmap.data[m+3]=255),b>0?(b=255/b,this.bitmap.data[m]=(r*v>>>x)*b,this.bitmap.data[m+1]=(i*v>>>x)*b,this.bitmap.data[m+2]=(n*v>>>x)*b):(this.bitmap.data[m+2]=0,this.bitmap.data[m+1]=0,this.bitmap.data[m]=0),0===o&&(A[s]=((u=s+w)<y?u:y)*this.bitmap.width,I[s]=(u=s-t)>0?u*this.bitmap.width:0),c=o+A[s],d=o+I[s],r+=E[c]-E[d],i+=k[c]-k[d],n+=S[c]-S[d],a+=M[c]-M[d],m+=this.bitmap.width<<2}}return h(e)&&e.call(this,null,this),this}}),()=>({circle(){let t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},e=arguments.length>1?arguments[1]:void 0;"function"==typeof t&&(e=t,t={});const r=t.radius||(this.bitmap.width>this.bitmap.height?this.bitmap.height:this.bitmap.width)/2,i="number"==typeof t.x?t.x:this.bitmap.width/2,n="number"==typeof t.y?t.y:this.bitmap.height/2;return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,a){const o=Math.sqrt(Math.pow(t-i,2)+Math.pow(e-n,2));r-o<=0?this.bitmap.data[a+3]=0:r-o<1&&(this.bitmap.data[a+3]=255*(r-o))})),h(e)&&e.call(this,null,this),this}}),()=>({brightness(t,e){return"number"!=typeof t?l.call(this,"val must be numbers",e):t<-1||t>1?l.call(this,"val must be a number between -1 and +1",e):(this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(e,r,i){t<0?(this.bitmap.data[i]*=1+t,this.bitmap.data[i+1]*=1+t,this.bitmap.data[i+2]*=1+t):(this.bitmap.data[i]+=(255-this.bitmap.data[i])*t,this.bitmap.data[i+1]+=(255-this.bitmap.data[i+1])*t,this.bitmap.data[i+2]+=(255-this.bitmap.data[i+2])*t)})),h(e)&&e.call(this,null,this),this)},contrast(t,e){if("number"!=typeof t)return l.call(this,"val must be numbers",e);if(t<-1||t>1)return l.call(this,"val must be a number between -1 and +1",e);const r=(t+1)/(1-t);function i(t){return(t=Math.floor(r*(t-127)+127))<0?0:t>255?255:t}return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){this.bitmap.data[r]=i(this.bitmap.data[r]),this.bitmap.data[r+1]=i(this.bitmap.data[r+1]),this.bitmap.data[r+2]=i(this.bitmap.data[r+2])})),h(e)&&e.call(this,null,this),this},posterize(t,e){return"number"!=typeof t?l.call(this,"n must be numbers",e):(t<2&&(t=2),this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(e,r,i){this.bitmap.data[i]=Math.floor(this.bitmap.data[i]/255*(t-1))/(t-1)*255,this.bitmap.data[i+1]=Math.floor(this.bitmap.data[i+1]/255*(t-1))/(t-1)*255,this.bitmap.data[i+2]=Math.floor(this.bitmap.data[i+2]/255*(t-1))/(t-1)*255})),h(e)&&e.call(this,null,this),this)},greyscale:Le,grayscale:Le,opacity(t,e){return"number"!=typeof t?l.call(this,"f must be a number",e):t<0||t>1?l.call(this,"f must be a number from 0 to 1",e):(this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(e,r,i){const n=this.bitmap.data[i+3]*t;this.bitmap.data[i+3]=n})),h(e)&&e.call(this,null,this),this)},sepia(t){return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){let i=this.bitmap.data[r],n=this.bitmap.data[r+1],a=this.bitmap.data[r+2];i=.393*i+.769*n+.189*a,n=.349*i+.686*n+.168*a,a=.272*i+.534*n+.131*a,this.bitmap.data[r]=i<255?i:255,this.bitmap.data[r+1]=n<255?n:255,this.bitmap.data[r+2]=a<255?a:255})),h(t)&&t.call(this,null,this),this},fade(t,e){return"number"!=typeof t?l.call(this,"f must be a number",e):t<0||t>1?l.call(this,"f must be a number from 0 to 1",e):(this.opacity(1-t),h(e)&&e.call(this,null,this),this)},convolution(t,e,r){"function"==typeof e&&void 0===r&&(r=e,e=null),e||(e=this.constructor.EDGE_EXTEND);const i=Re.from(this.bitmap.data),n=t.length,a=t[0].length,o=Math.floor(n/2),s=Math.floor(a/2),l=-o,f=-s;let u,c,d,p,m,g,b,_,y,w;return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(r,n,a){p=0,d=0,c=0;for(let i=l;i<=o;i++)for(let a=f;a<=s;a++)_=r+a,y=n+i,u=t[i+o][a+s],w=this.getPixelIndex(_,y,e),-1===w?(b=0,g=0,m=0):(m=this.bitmap.data[w+0],g=this.bitmap.data[w+1],b=this.bitmap.data[w+2]),c+=u*m,d+=u*g,p+=u*b;c<0&&(c=0),d<0&&(d=0),p<0&&(p=0),c>255&&(c=255),d>255&&(d=255),p>255&&(p=255),i[a+0]=c,i[a+1]=d,i[a+2]=p})),this.bitmap.data=i,h(r)&&r.call(this,null,this),this},opaque(t){return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){this.bitmap.data[r+3]=255})),h(t)&&t.call(this,null,this),this},pixelate(t,e,r,i,n,a){if("function"==typeof e)a=e,n=null,i=null,r=null,e=null;else{if("number"!=typeof t)return l.call(this,"size must be a number",a);if(Oe(e)&&"number"!=typeof e)return l.call(this,"x must be a number",a);if(Oe(r)&&"number"!=typeof r)return l.call(this,"y must be a number",a);if(Oe(i)&&"number"!=typeof i)return l.call(this,"w must be a number",a);if(Oe(n)&&"number"!=typeof n)return l.call(this,"h must be a number",a)}const o=[[1/16,2/16,1/16],[2/16,.25,2/16],[1/16,2/16,1/16]];e=e||0,r=r||0,i=Oe(i)?i:this.bitmap.width-e,n=Oe(n)?n:this.bitmap.height-r;const s=this.cloneQuiet();return this.scanQuiet(e,r,i,n,(function(e,r,i){e=t*Math.floor(e/t),r=t*Math.floor(r/t);const n=Pe(s,o,e,r);this.bitmap.data[i]=n[0],this.bitmap.data[i+1]=n[1],this.bitmap.data[i+2]=n[2]})),h(a)&&a.call(this,null,this),this},convolute(t,e,r,i,n,a){if(!Array.isArray(t))return l.call(this,"the kernel must be an array",a);if("function"==typeof e)a=e,e=null,r=null,i=null,n=null;else{if(Oe(e)&&"number"!=typeof e)return l.call(this,"x must be a number",a);if(Oe(r)&&"number"!=typeof r)return l.call(this,"y must be a number",a);if(Oe(i)&&"number"!=typeof i)return l.call(this,"w must be a number",a);if(Oe(n)&&"number"!=typeof n)return l.call(this,"h must be a number",a)}e=Oe(e)?e:0,r=Oe(r)?r:0,i=Oe(i)?i:this.bitmap.width-e,n=Oe(n)?n:this.bitmap.height-r;const o=this.cloneQuiet();return this.scanQuiet(e,r,i,n,(function(e,r,i){const n=Pe(o,t,e,r);this.bitmap.data[i]=this.constructor.limit255(n[0]),this.bitmap.data[i+1]=this.constructor.limit255(n[1]),this.bitmap.data[i+2]=this.constructor.limit255(n[2])})),h(a)&&a.call(this,null,this),this},color:Ue,colour:Ue}),()=>({contain(t,e,r,i,n){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"w and h must be numbers",n);"string"==typeof r&&("function"==typeof i&&void 0===n&&(n=i),i=r,r=null),"function"==typeof r&&(void 0===n&&(n=r),i=null,r=null),"function"==typeof i&&void 0===n&&(n=i,i=null);const a=7&(r=r||this.constructor.HORIZONTAL_ALIGN_CENTER|this.constructor.VERTICAL_ALIGN_MIDDLE),o=r>>3;if((0===a||a&a-1)&&(0===o||o&o-1))return l.call(this,"only use one flag per alignment direction",n);const s=a>>1,f=o>>1,u=t/e>this.bitmap.width/this.bitmap.height?e/this.bitmap.height:t/this.bitmap.width,c=this.cloneQuiet().scale(u,i);return this.resize(t,e,i),this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){this.bitmap.data.writeUInt32BE(this._background,r)})),this.blit(c,(this.bitmap.width-c.bitmap.width)/2*s,(this.bitmap.height-c.bitmap.height)/2*f),h(n)&&n.call(this,null,this),this}}),()=>({cover(t,e,r,i,n){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"w and h must be numbers",n);r&&"function"==typeof r&&void 0===n?(n=r,r=null,i=null):"function"==typeof i&&void 0===n&&(n=i,i=null);const a=7&(r=r||this.constructor.HORIZONTAL_ALIGN_CENTER|this.constructor.VERTICAL_ALIGN_MIDDLE),o=r>>3;if((0===a||a&a-1)&&(0===o||o&o-1))return l.call(this,"only use one flag per alignment direction",n);const s=a>>1,f=o>>1,u=t/e>this.bitmap.width/this.bitmap.height?t/this.bitmap.width:e/this.bitmap.height;return this.scale(u,i),this.crop((this.bitmap.width-t)/2*s,(this.bitmap.height-e)/2*f,t,e),h(n)&&n.call(this,null,this),this}}),function(t){return t("crop",(function(t,e,r,i,n){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"x and y must be numbers",n);if("number"!=typeof r||"number"!=typeof i)return l.call(this,"w and h must be numbers",n);if(t=Math.round(t),e=Math.round(e),r=Math.round(r),i=Math.round(i),0===t&&r===this.bitmap.width){const n=r*e+t<<2,a=n+(i*r<<2);this.bitmap.data=this.bitmap.data.slice(n,a)}else{const n=ze.allocUnsafe(r*i*4);let a=0;this.scanQuiet(t,e,r,i,(function(t,e,r){const i=this.bitmap.data.readUInt32BE(r,!0);n.writeUInt32BE(i,a,!0),a+=4})),this.bitmap.data=n}return this.bitmap.width=r,this.bitmap.height=i,h(n)&&n.call(this,null,this),this})),{class:{autocrop(){const t=this.bitmap.width,e=this.bitmap.height;let r,i=0,n=2e-4,a=!0,o=!1,s={north:!1,south:!1,east:!1,west:!1};for(var l=arguments.length,f=new Array(l),u=0;u<l;u++)f[u]=arguments[u];for(let t=0,e=f.length;t<e;t++)if("number"==typeof f[t]&&(n=f[t]),"boolean"==typeof f[t]&&(a=f[t]),"function"==typeof f[t]&&(r=f[t]),"object"==typeof f[t]){const e=f[t];void 0!==e.tolerance&&({tolerance:n}=e),void 0!==e.cropOnlyFrames&&({cropOnlyFrames:a}=e),void 0!==e.cropSymmetric&&({cropSymmetric:o}=e),void 0!==e.leaveBorder&&({leaveBorder:i}=e),void 0!==e.ignoreSides&&({ignoreSides:s}=e)}let c=this.getPixelColor(0,0);const d=this.constructor.intToRGBA(c);let p=0,m=0,g=0,b=0;if(c=this.getPixelColor(0,0),!s.north)t:for(let r=0;r<e-1;r++){for(let e=0;e<t;e++){const t=this.getPixelColor(e,r),i=this.constructor.intToRGBA(t);if(this.constructor.colorDiff(d,i)>n)break t}p++}if(c=this.getPixelColor(t,0),!s.west)t:for(let r=0;r<t-1;r++){for(let t=0+p;t<e;t++){const e=this.getPixelColor(r,t),i=this.constructor.intToRGBA(e);if(this.constructor.colorDiff(d,i)>n)break t}b++}if(c=this.getPixelColor(0,e),!s.south)t:for(let r=e-1;r>=p+1;r--){for(let e=t-m-1;e>=0;e--){const t=this.getPixelColor(e,r),i=this.constructor.intToRGBA(t);if(this.constructor.colorDiff(d,i)>n)break t}g++}if(c=this.getPixelColor(t,e),!s.east)t:for(let r=t-1;r>=0+b+1;r--){for(let t=e-1;t>=0+p;t--){const e=this.getPixelColor(r,t),i=this.constructor.intToRGBA(e);if(this.constructor.colorDiff(d,i)>n)break t}m++}let _=!1;if(b-=i,m-=i,p-=i,g-=i,o){const t=Math.min(m,b),e=Math.min(p,g);b=t,m=t,p=e,g=e}b=b>=0?b:0,m=m>=0?m:0,p=p>=0?p:0,g=g>=0?g:0;const y=t-(b+m),w=e-(g+p);return _=a?0!==m&&0!==p&&0!==b&&0!==g:0!==m||0!==p||0!==b||0!==g,_&&this.crop(b,p,y,w),h(r)&&r.call(this,null,this),this}}}},()=>({displace(t,e,r){if("object"!=typeof t||t.constructor!==this.constructor)return l.call(this,"The source must be a Jimp image",r);if("number"!=typeof e)return l.call(this,"factor must be a number",r);const i=this.cloneQuiet();return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(r,n,a){let o=t.bitmap.data[a]/256*e;o=Math.round(o);const s=this.getPixelIndex(r+o,n);this.bitmap.data[s]=i.bitmap.data[a],this.bitmap.data[s+1]=i.bitmap.data[a+1],this.bitmap.data[s+2]=i.bitmap.data[a+2]})),h(r)&&r.call(this,null,this),this}}),()=>({dither565:De,dither16:De}),()=>({fisheye(){let t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{r:2.5},e=arguments.length>1?arguments[1]:void 0;"function"==typeof t&&(e=t,t={r:2.5});const r=this.cloneQuiet(),{width:i,height:n}=r.bitmap;return r.scanQuiet(0,0,i,n,((e,a)=>{const o=e/i,s=a/n,h=Math.sqrt(Math.pow(o-.5,2)+Math.pow(s-.5,2)),l=2*Math.pow(h,t.r),f=(o-.5)/h,u=(s-.5)/h,c=Math.round((l*f+.5)*i),d=Math.round((l*u+.5)*n),p=r.getPixelColor(c,d);this.setPixelColor(p,e,a)})),this.setPixelColor(r.getPixelColor(i/2,n/2),i/2,n/2),h(e)&&e.call(this,null,this),this}}),()=>({flip:Fe,mirror:Fe}),()=>({gaussian(t,e){if("number"!=typeof t)return l.call(this,"r must be a number",e);if(t<1)return l.call(this,"r must be greater than 0",e);const r=Math.ceil(2.57*t),i=2*r+1,n=t*t*2,a=n*Math.PI,o=[];for(let t=0;t<i;t++){o[t]=[];for(let e=0;e<i;e++){const i=(e-r)**2+(t-r)**2;o[t][e]=Math.exp(-i/n)/a}}for(let t=0;t<this.bitmap.height;t++)for(let e=0;e<this.bitmap.width;e++){let n=0,a=0,s=0,h=0,l=0;for(let f=0;f<i;f++){for(let u=0;u<i;u++){const i=Math.min(this.bitmap.width-1,Math.max(0,u+e-r)),c=Math.min(this.bitmap.height-1,Math.max(0,f+t-r)),d=o[f][u],p=c*this.bitmap.width+i<<2;n+=this.bitmap.data[p]*d,a+=this.bitmap.data[p+1]*d,s+=this.bitmap.data[p+2]*d,h+=this.bitmap.data[p+3]*d,l+=d}const u=t*this.bitmap.width+e<<2;this.bitmap.data[u]=Math.round(n/l),this.bitmap.data[u+1]=Math.round(a/l),this.bitmap.data[u+2]=Math.round(s/l),this.bitmap.data[u+3]=Math.round(h/l)}}return h(e)&&e.call(this,null,this),this}}),()=>({invert(t){return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,r){this.bitmap.data[r]=255-this.bitmap.data[r],this.bitmap.data[r+1]=255-this.bitmap.data[r+1],this.bitmap.data[r+2]=255-this.bitmap.data[r+2]})),h(t)&&t.call(this,null,this),this}}),()=>({mask(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0,r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:0,i=arguments.length>3?arguments[3]:void 0;if(!(t instanceof this.constructor))return l.call(this,"The source must be a Jimp image",i);if("number"!=typeof e||"number"!=typeof r)return l.call(this,"x and y must be numbers",i);e=Math.round(e),r=Math.round(r);const n=this.bitmap.width,a=this.bitmap.height,o=this;return t.scanQuiet(0,0,t.bitmap.width,t.bitmap.height,(function(t,i,s){const h=e+t,l=r+i;if(h>=0&&l>=0&&h<n&&l<a){const t=o.getPixelIndex(h,l),{data:e}=this.bitmap,r=(e[s+0]+e[s+1]+e[s+2])/3;o.bitmap.data[t+3]*=r/255}})),h(i)&&i.call(this,null,this),this}}),()=>({normalize(t){const e=je.call(this),r={r:He(e.r),g:He(e.g),b:He(e.b)};return this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,(function(t,e,i){const n=this.bitmap.data[i+0],a=this.bitmap.data[i+1],o=this.bitmap.data[i+2];this.bitmap.data[i+0]=Ge(n,r.r[0],r.r[1]),this.bitmap.data[i+1]=Ge(a,r.g[0],r.g[1]),this.bitmap.data[i+2]=Ge(o,r.b[0],r.b[1])})),h(t)&&t.call(this,null,this),this}}),()=>({constants:{measureText:Ze,measureTextHeight:Ve,FONT_SANS_8_BLACK:a().join(Qe,"fonts/open-sans/open-sans-8-black/open-sans-8-black.fnt"),FONT_SANS_10_BLACK:a().join(Qe,"fonts/open-sans/open-sans-10-black/open-sans-10-black.fnt"),FONT_SANS_12_BLACK:a().join(Qe,"fonts/open-sans/open-sans-12-black/open-sans-12-black.fnt"),FONT_SANS_14_BLACK:a().join(Qe,"fonts/open-sans/open-sans-14-black/open-sans-14-black.fnt"),FONT_SANS_16_BLACK:a().join(Qe,"fonts/open-sans/open-sans-16-black/open-sans-16-black.fnt"),FONT_SANS_32_BLACK:a().join(Qe,"fonts/open-sans/open-sans-32-black/open-sans-32-black.fnt"),FONT_SANS_64_BLACK:a().join(Qe,"fonts/open-sans/open-sans-64-black/open-sans-64-black.fnt"),FONT_SANS_128_BLACK:a().join(Qe,"fonts/open-sans/open-sans-128-black/open-sans-128-black.fnt"),FONT_SANS_8_WHITE:a().join(Qe,"fonts/open-sans/open-sans-8-white/open-sans-8-white.fnt"),FONT_SANS_16_WHITE:a().join(Qe,"fonts/open-sans/open-sans-16-white/open-sans-16-white.fnt"),FONT_SANS_32_WHITE:a().join(Qe,"fonts/open-sans/open-sans-32-white/open-sans-32-white.fnt"),FONT_SANS_64_WHITE:a().join(Qe,"fonts/open-sans/open-sans-64-white/open-sans-64-white.fnt"),FONT_SANS_128_WHITE:a().join(Qe,"fonts/open-sans/open-sans-128-white/open-sans-128-white.fnt"),loadFont(t,e){return"string"!=typeof t?l.call(this,"file must be a string",e):new Promise(((r,i)=>{e=e||function(t,e){t?i(t):r(e)},qe()(t,((r,i)=>{const n={},o={};if(r)return l.call(this,r,e);for(let t=0;t<i.chars.length;t++)n[String.fromCharCode(i.chars[t].id)]=i.chars[t];for(let t=0;t<i.kernings.length;t++){const e=String.fromCharCode(i.kernings[t].first);o[e]=o[e]||{},o[e][String.fromCharCode(i.kernings[t].second)]=i.kernings[t].amount}(function(t,e,r){const i=r.map((r=>t.read(e+"/"+r)));return Promise.all(i)})(this,a().dirname(t),i.pages).then((t=>{e(null,{chars:n,kernings:o,pages:t,common:i.common,info:i.info})}))}))}))}},class:{print(t,e,r,i,n,a,o){if("function"==typeof n&&void 0===o&&(o=n,n=1/0),void 0===n&&(n=1/0),"function"==typeof a&&void 0===o&&(o=a,a=1/0),void 0===a&&(a=1/0),"object"!=typeof t)return l.call(this,"font must be a Jimp loadFont",o);if("number"!=typeof e||"number"!=typeof r||"number"!=typeof n)return l.call(this,"x, y and maxWidth must be numbers",o);if("number"!=typeof n)return l.call(this,"maxWidth must be a number",o);if("number"!=typeof a)return l.call(this,"maxHeight must be a number",o);let s,f;"object"==typeof i&&null!==i.text&&void 0!==i.text?(s=i.alignmentX||this.constructor.HORIZONTAL_ALIGN_LEFT,f=i.alignmentY||this.constructor.VERTICAL_ALIGN_TOP,({text:i}=i)):(s=this.constructor.HORIZONTAL_ALIGN_LEFT,f=this.constructor.VERTICAL_ALIGN_TOP,i=i.toString()),a!==1/0&&f===this.constructor.VERTICAL_ALIGN_BOTTOM?r+=a-Ve(t,i,n):a!==1/0&&f===this.constructor.VERTICAL_ALIGN_MIDDLE&&(r+=a/2-Ve(t,i,n)/2);const u=Object.entries(t.chars)[0][1].xadvance,{lines:c,longestLine:d}=Ye(t,i,n);return c.forEach((i=>{const a=i.join(" "),o=function(t,e,r,i,n){return n===t.HORIZONTAL_ALIGN_LEFT?0:n===t.HORIZONTAL_ALIGN_CENTER?(i-Ze(e,r))/2:i-Ze(e,r)}(this.constructor,t,a,n,s);Je.call(this,t,e+o,r,a,u),r+=t.common.lineHeight})),h(o)&&o.call(this,null,this,{x:e+d,y:r}),this}}}),()=>({constants:{RESIZE_NEAREST_NEIGHBOR:"nearestNeighbor",RESIZE_BILINEAR:"bilinearInterpolation",RESIZE_BICUBIC:"bicubicInterpolation",RESIZE_HERMITE:"hermiteInterpolation",RESIZE_BEZIER:"bezierInterpolation"},class:{resize(t,e,r,i){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"w and h must be numbers",i);if("function"==typeof r&&void 0===i&&(i=r,r=null),t===this.constructor.AUTO&&e===this.constructor.AUTO)return l.call(this,"w and h cannot both be set to auto",i);if(t===this.constructor.AUTO&&(t=this.bitmap.width*(e/this.bitmap.height)),e===this.constructor.AUTO&&(e=this.bitmap.height*(t/this.bitmap.width)),t<0||e<0)return l.call(this,"w and h must be positive numbers",i);if(t=Math.round(t)||1,e=Math.round(e)||1,"function"==typeof rr[r]){const i={data:ir.alloc(t*e*4),width:t,height:e};rr[r](this.bitmap,i),this.bitmap=i}else{const r=this;new $e(this.bitmap.width,this.bitmap.height,t,e,!0,!0,(i=>{r.bitmap.data=ir.from(i),r.bitmap.width=t,r.bitmap.height=e})).resize(this.bitmap.data)}return h(i)&&i.call(this,null,this),this}}}),()=>({rotate(t,e,r){return null==e&&(e=!0),"function"==typeof e&&void 0===r&&(r=e,e=!0),"number"!=typeof t?l.call(this,"deg must be a number",r):"boolean"!=typeof e&&"string"!=typeof e?l.call(this,"mode must be a boolean or a string",r):(t%90!=0||!e&&this.bitmap.width!==this.bitmap.height&&t%180!=0?or.call(this,t,e,r):ar.call(this,t),h(r)&&r.call(this,null,this),this)}}),()=>({scale(t,e,r){if("number"!=typeof t)return l.call(this,"f must be a number",r);if(t<0)return l.call(this,"f must be a positive number",r);"function"==typeof e&&void 0===r&&(r=e,e=null);const i=this.bitmap.width*t,n=this.bitmap.height*t;return this.resize(i,n,e),h(r)&&r.call(this,null,this),this},scaleToFit(t,e,r,i){if("number"!=typeof t||"number"!=typeof e)return l.call(this,"w and h must be numbers",i);"function"==typeof r&&void 0===i&&(i=r,r=null);const n=t/e>this.bitmap.width/this.bitmap.height?e/this.bitmap.height:t/this.bitmap.width;return this.scale(n,r),h(i)&&i.call(this,null,this),this}}),()=>({shadow(){let t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},e=arguments.length>1?arguments[1]:void 0;"function"==typeof t&&(e=t,t={});const{opacity:r=.7,size:i=1.1,x:n=-25,y:a=25,blur:o=5}=t,s=this.clone(),l=this.clone();return l.scan(0,0,l.bitmap.width,l.bitmap.height,((t,e,i)=>{l.bitmap.data[i]=0,l.bitmap.data[i+1]=0,l.bitmap.data[i+2]=0,l.bitmap.data[i+3]=l.constructor.limit255(l.bitmap.data[i+3]*r),this.bitmap.data[i]=0,this.bitmap.data[i+1]=0,this.bitmap.data[i+2]=0,this.bitmap.data[i+3]=0})),l.resize(l.bitmap.width*i,l.bitmap.height*i).blur(o),this.composite(l,n,a),this.composite(s,0,0),h(e)&&e.call(this,null,this),this}}),()=>({threshold(t,e){let{max:r,replace:i=255,autoGreyscale:n=!0}=t;return"number"!=typeof r?l.call(this,"max must be a number",e):"number"!=typeof i?l.call(this,"replace must be a number",e):"boolean"!=typeof n?l.call(this,"autoGreyscale must be a boolean",e):(r=this.constructor.limit255(r),i=this.constructor.limit255(i),n&&this.greyscale(),this.scanQuiet(0,0,this.bitmap.width,this.bitmap.height,((t,e,n)=>{const a=this.bitmap.data[n]<r?this.bitmap.data[n]:i;this.bitmap.data[n]=a,this.bitmap.data[n+1]=a,this.bitmap.data[n+2]=a})),h(e)&&e.call(this,null,this),this)}})];!function(t){let e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:oe;const r={hasAlpha:{},encoders:{},decoders:{},class:{},constants:{}};function i(t){Object.entries(t).forEach((t=>{let[e,i]=t;r[e]={...r[e],...i}}))}t.types&&(t.types.forEach((function(t){const e=t();Array.isArray(e.mime)?Ct(...e.mime):Object.entries(e.mime).forEach((t=>Ct(...t))),delete e.mime,i(e)})),e.decoders={...e.decoders,...r.decoders},e.encoders={...e.encoders,...r.encoders},e.hasAlpha={...e.hasAlpha,...r.hasAlpha}),t.plugins&&t.plugins.forEach((function(t){const e=t(ae)||{};e.class||e.constants?i(e):i({class:e})})),ie(r.class,e),re(r.constants,e)}({types:[()=>(0,se.Ee)(ue(),pe(),{mime:{[be]:["bmp"]},constants:{MIME_BMP:be,MIME_X_MS_BMP:_e},decoders:{[be]:ye,[_e]:ye},encoders:{[be]:we,[_e]:we}},{mime:{[ke]:["tiff","tif"]},constants:{MIME_TIFF:ke},decoders:{[ke]:t=>{const e=xe().decode(t),r=e[0];e.forEach((e=>{xe().decodeImage(t,e)}));const i=xe().toRGBA8(r);return{data:Ee.from(i),width:r.t256[0],height:r.t257[0]}}},encoders:{[ke]:t=>{const e=xe().encodeImage(t.bitmap.data,t.bitmap.width,t.bitmap.height);return Ee.from(e)}}},{mime:{[Ie]:["gif"]},constants:{MIME_GIF:Ie},decoders:{[Ie]:t=>{const e=new Se.N(t),r=Ae.alloc(e.width*e.height*4);return e.decodeAndBlitFrameRGBA(0,r),{data:r,width:e.width,height:e.height}}},encoders:{[Ie]:t=>{const e=new Me.BitmapImage(t.bitmap);Me.GifUtil.quantizeDekker(e,256);const r=new Me.GifFrame(e);return(new Me.GifCodec).encodeGif([r],{}).then((t=>t.buffer))}}})],plugins:[t=>{const e=sr.map((e=>{let r=e(t)||{};return r.class||r.constants||(r={class:r}),r}));return(0,se.Ee)(...e)}]})})()})();

}).call(this)}).call(this,require("timers").setImmediate)
},{"timers":51}],15:[function(require,module,exports){
(function (process){(function (){
// 'path' module extracted from Node.js v8.11.1 (only the posix part)
// transplited with Babel

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

function assertPath(path) {
  if (typeof path !== 'string') {
    throw new TypeError('Path must be a string. Received ' + JSON.stringify(path));
  }
}

// Resolves . and .. elements in a path with directory names
function normalizeStringPosix(path, allowAboveRoot) {
  var res = '';
  var lastSegmentLength = 0;
  var lastSlash = -1;
  var dots = 0;
  var code;
  for (var i = 0; i <= path.length; ++i) {
    if (i < path.length)
      code = path.charCodeAt(i);
    else if (code === 47 /*/*/)
      break;
    else
      code = 47 /*/*/;
    if (code === 47 /*/*/) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 /*.*/ || res.charCodeAt(res.length - 2) !== 46 /*.*/) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf('/');
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1) {
                res = '';
                lastSegmentLength = 0;
              } else {
                res = res.slice(0, lastSlashIndex);
                lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
              }
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0)
            res += '/..';
          else
            res = '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += '/' + path.slice(lastSlash + 1, i);
        else
          res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 /*.*/ && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function _format(sep, pathObject) {
  var dir = pathObject.dir || pathObject.root;
  var base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');
  if (!dir) {
    return base;
  }
  if (dir === pathObject.root) {
    return dir + base;
  }
  return dir + sep + base;
}

var posix = {
  // path.resolve([from ...], to)
  resolve: function resolve() {
    var resolvedPath = '';
    var resolvedAbsolute = false;
    var cwd;

    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path;
      if (i >= 0)
        path = arguments[i];
      else {
        if (cwd === undefined)
          cwd = process.cwd();
        path = cwd;
      }

      assertPath(path);

      // Skip empty entries
      if (path.length === 0) {
        continue;
      }

      resolvedPath = path + '/' + resolvedPath;
      resolvedAbsolute = path.charCodeAt(0) === 47 /*/*/;
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);

    if (resolvedAbsolute) {
      if (resolvedPath.length > 0)
        return '/' + resolvedPath;
      else
        return '/';
    } else if (resolvedPath.length > 0) {
      return resolvedPath;
    } else {
      return '.';
    }
  },

  normalize: function normalize(path) {
    assertPath(path);

    if (path.length === 0) return '.';

    var isAbsolute = path.charCodeAt(0) === 47 /*/*/;
    var trailingSeparator = path.charCodeAt(path.length - 1) === 47 /*/*/;

    // Normalize the path
    path = normalizeStringPosix(path, !isAbsolute);

    if (path.length === 0 && !isAbsolute) path = '.';
    if (path.length > 0 && trailingSeparator) path += '/';

    if (isAbsolute) return '/' + path;
    return path;
  },

  isAbsolute: function isAbsolute(path) {
    assertPath(path);
    return path.length > 0 && path.charCodeAt(0) === 47 /*/*/;
  },

  join: function join() {
    if (arguments.length === 0)
      return '.';
    var joined;
    for (var i = 0; i < arguments.length; ++i) {
      var arg = arguments[i];
      assertPath(arg);
      if (arg.length > 0) {
        if (joined === undefined)
          joined = arg;
        else
          joined += '/' + arg;
      }
    }
    if (joined === undefined)
      return '.';
    return posix.normalize(joined);
  },

  relative: function relative(from, to) {
    assertPath(from);
    assertPath(to);

    if (from === to) return '';

    from = posix.resolve(from);
    to = posix.resolve(to);

    if (from === to) return '';

    // Trim any leading backslashes
    var fromStart = 1;
    for (; fromStart < from.length; ++fromStart) {
      if (from.charCodeAt(fromStart) !== 47 /*/*/)
        break;
    }
    var fromEnd = from.length;
    var fromLen = fromEnd - fromStart;

    // Trim any leading backslashes
    var toStart = 1;
    for (; toStart < to.length; ++toStart) {
      if (to.charCodeAt(toStart) !== 47 /*/*/)
        break;
    }
    var toEnd = to.length;
    var toLen = toEnd - toStart;

    // Compare paths to find the longest common path from root
    var length = fromLen < toLen ? fromLen : toLen;
    var lastCommonSep = -1;
    var i = 0;
    for (; i <= length; ++i) {
      if (i === length) {
        if (toLen > length) {
          if (to.charCodeAt(toStart + i) === 47 /*/*/) {
            // We get here if `from` is the exact base path for `to`.
            // For example: from='/foo/bar'; to='/foo/bar/baz'
            return to.slice(toStart + i + 1);
          } else if (i === 0) {
            // We get here if `from` is the root
            // For example: from='/'; to='/foo'
            return to.slice(toStart + i);
          }
        } else if (fromLen > length) {
          if (from.charCodeAt(fromStart + i) === 47 /*/*/) {
            // We get here if `to` is the exact base path for `from`.
            // For example: from='/foo/bar/baz'; to='/foo/bar'
            lastCommonSep = i;
          } else if (i === 0) {
            // We get here if `to` is the root.
            // For example: from='/foo'; to='/'
            lastCommonSep = 0;
          }
        }
        break;
      }
      var fromCode = from.charCodeAt(fromStart + i);
      var toCode = to.charCodeAt(toStart + i);
      if (fromCode !== toCode)
        break;
      else if (fromCode === 47 /*/*/)
        lastCommonSep = i;
    }

    var out = '';
    // Generate the relative path based on the path difference between `to`
    // and `from`
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === 47 /*/*/) {
        if (out.length === 0)
          out += '..';
        else
          out += '/..';
      }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    if (out.length > 0)
      return out + to.slice(toStart + lastCommonSep);
    else {
      toStart += lastCommonSep;
      if (to.charCodeAt(toStart) === 47 /*/*/)
        ++toStart;
      return to.slice(toStart);
    }
  },

  _makeLong: function _makeLong(path) {
    return path;
  },

  dirname: function dirname(path) {
    assertPath(path);
    if (path.length === 0) return '.';
    var code = path.charCodeAt(0);
    var hasRoot = code === 47 /*/*/;
    var end = -1;
    var matchedSlash = true;
    for (var i = path.length - 1; i >= 1; --i) {
      code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          if (!matchedSlash) {
            end = i;
            break;
          }
        } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 1) return '//';
    return path.slice(0, end);
  },

  basename: function basename(path, ext) {
    if (ext !== undefined && typeof ext !== 'string') throw new TypeError('"ext" argument must be a string');
    assertPath(path);

    var start = 0;
    var end = -1;
    var matchedSlash = true;
    var i;

    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
      if (ext.length === path.length && ext === path) return '';
      var extIdx = ext.length - 1;
      var firstNonSlashEnd = -1;
      for (i = path.length - 1; i >= 0; --i) {
        var code = path.charCodeAt(i);
        if (code === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === ext.charCodeAt(extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end) end = firstNonSlashEnd;else if (end === -1) end = path.length;
      return path.slice(start, end);
    } else {
      for (i = path.length - 1; i >= 0; --i) {
        if (path.charCodeAt(i) === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else if (end === -1) {
          // We saw the first non-path separator, mark this as the end of our
          // path component
          matchedSlash = false;
          end = i + 1;
        }
      }

      if (end === -1) return '';
      return path.slice(start, end);
    }
  },

  extname: function extname(path) {
    assertPath(path);
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    var preDotState = 0;
    for (var i = path.length - 1; i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46 /*.*/) {
          // If this is our first dot, mark it as the start of our extension
          if (startDot === -1)
            startDot = i;
          else if (preDotState !== 1)
            preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      return '';
    }
    return path.slice(startDot, end);
  },

  format: function format(pathObject) {
    if (pathObject === null || typeof pathObject !== 'object') {
      throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
    }
    return _format('/', pathObject);
  },

  parse: function parse(path) {
    assertPath(path);

    var ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0) return ret;
    var code = path.charCodeAt(0);
    var isAbsolute = code === 47 /*/*/;
    var start;
    if (isAbsolute) {
      ret.root = '/';
      start = 1;
    } else {
      start = 0;
    }
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    var i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    var preDotState = 0;

    // Get non-dir info
    for (; i >= start; --i) {
      code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46 /*.*/) {
          // If this is our first dot, mark it as the start of our extension
          if (startDot === -1) startDot = i;else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      if (end !== -1) {
        if (startPart === 0 && isAbsolute) ret.base = ret.name = path.slice(1, end);else ret.base = ret.name = path.slice(startPart, end);
      }
    } else {
      if (startPart === 0 && isAbsolute) {
        ret.name = path.slice(1, startDot);
        ret.base = path.slice(1, end);
      } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
      }
      ret.ext = path.slice(startDot, end);
    }

    if (startPart > 0) ret.dir = path.slice(0, startPart - 1);else if (isAbsolute) ret.dir = '/';

    return ret;
  },

  sep: '/',
  delimiter: ':',
  win32: null,
  posix: null
};

posix.posix = posix;

module.exports = posix;

}).call(this)}).call(this,require('_process'))
},{"_process":16}],16:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],17:[function(require,module,exports){
// full library entry point.

"use strict";
module.exports = require("./src/index");

},{"./src/index":26}],18:[function(require,module,exports){
"use strict";
module.exports = common;

var commonRe = /\/|\./;

/**
 * Provides common type definitions.
 * Can also be used to provide additional google types or your own custom types.
 * @param {string} name Short name as in `google/protobuf/[name].proto` or full file name
 * @param {Object.<string,*>} json JSON definition within `google.protobuf` if a short name, otherwise the file's root definition
 * @returns {undefined}
 * @property {INamespace} google/protobuf/any.proto Any
 * @property {INamespace} google/protobuf/duration.proto Duration
 * @property {INamespace} google/protobuf/empty.proto Empty
 * @property {INamespace} google/protobuf/field_mask.proto FieldMask
 * @property {INamespace} google/protobuf/struct.proto Struct, Value, NullValue and ListValue
 * @property {INamespace} google/protobuf/timestamp.proto Timestamp
 * @property {INamespace} google/protobuf/wrappers.proto Wrappers
 * @example
 * // manually provides descriptor.proto (assumes google/protobuf/ namespace and .proto extension)
 * protobuf.common("descriptor", descriptorJson);
 *
 * // manually provides a custom definition (uses my.foo namespace)
 * protobuf.common("my/foo/bar.proto", myFooBarJson);
 */
function common(name, json) {
    if (!commonRe.test(name)) {
        name = "google/protobuf/" + name + ".proto";
        json = { nested: { google: { nested: { protobuf: { nested: json } } } } };
    }
    common[name] = json;
}

// Not provided because of limited use (feel free to discuss or to provide yourself):
//
// google/protobuf/descriptor.proto
// google/protobuf/source_context.proto
// google/protobuf/type.proto
//
// Stripped and pre-parsed versions of these non-bundled files are instead available as part of
// the repository or package within the google/protobuf directory.

common("any", {

    /**
     * Properties of a google.protobuf.Any message.
     * @interface IAny
     * @type {Object}
     * @property {string} [typeUrl]
     * @property {Uint8Array} [bytes]
     * @memberof common
     */
    Any: {
        fields: {
            type_url: {
                type: "string",
                id: 1
            },
            value: {
                type: "bytes",
                id: 2
            }
        }
    }
});

var timeType;

common("duration", {

    /**
     * Properties of a google.protobuf.Duration message.
     * @interface IDuration
     * @type {Object}
     * @property {number|Long} [seconds]
     * @property {number} [nanos]
     * @memberof common
     */
    Duration: timeType = {
        fields: {
            seconds: {
                type: "int64",
                id: 1
            },
            nanos: {
                type: "int32",
                id: 2
            }
        }
    }
});

common("timestamp", {

    /**
     * Properties of a google.protobuf.Timestamp message.
     * @interface ITimestamp
     * @type {Object}
     * @property {number|Long} [seconds]
     * @property {number} [nanos]
     * @memberof common
     */
    Timestamp: timeType
});

common("empty", {

    /**
     * Properties of a google.protobuf.Empty message.
     * @interface IEmpty
     * @memberof common
     */
    Empty: {
        fields: {}
    }
});

common("struct", {

    /**
     * Properties of a google.protobuf.Struct message.
     * @interface IStruct
     * @type {Object}
     * @property {Object.<string,IValue>} [fields]
     * @memberof common
     */
    Struct: {
        fields: {
            fields: {
                keyType: "string",
                type: "Value",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.Value message.
     * @interface IValue
     * @type {Object}
     * @property {string} [kind]
     * @property {0} [nullValue]
     * @property {number} [numberValue]
     * @property {string} [stringValue]
     * @property {boolean} [boolValue]
     * @property {IStruct} [structValue]
     * @property {IListValue} [listValue]
     * @memberof common
     */
    Value: {
        oneofs: {
            kind: {
                oneof: [
                    "nullValue",
                    "numberValue",
                    "stringValue",
                    "boolValue",
                    "structValue",
                    "listValue"
                ]
            }
        },
        fields: {
            nullValue: {
                type: "NullValue",
                id: 1
            },
            numberValue: {
                type: "double",
                id: 2
            },
            stringValue: {
                type: "string",
                id: 3
            },
            boolValue: {
                type: "bool",
                id: 4
            },
            structValue: {
                type: "Struct",
                id: 5
            },
            listValue: {
                type: "ListValue",
                id: 6
            }
        }
    },

    NullValue: {
        values: {
            NULL_VALUE: 0
        }
    },

    /**
     * Properties of a google.protobuf.ListValue message.
     * @interface IListValue
     * @type {Object}
     * @property {Array.<IValue>} [values]
     * @memberof common
     */
    ListValue: {
        fields: {
            values: {
                rule: "repeated",
                type: "Value",
                id: 1
            }
        }
    }
});

common("wrappers", {

    /**
     * Properties of a google.protobuf.DoubleValue message.
     * @interface IDoubleValue
     * @type {Object}
     * @property {number} [value]
     * @memberof common
     */
    DoubleValue: {
        fields: {
            value: {
                type: "double",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.FloatValue message.
     * @interface IFloatValue
     * @type {Object}
     * @property {number} [value]
     * @memberof common
     */
    FloatValue: {
        fields: {
            value: {
                type: "float",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.Int64Value message.
     * @interface IInt64Value
     * @type {Object}
     * @property {number|Long} [value]
     * @memberof common
     */
    Int64Value: {
        fields: {
            value: {
                type: "int64",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.UInt64Value message.
     * @interface IUInt64Value
     * @type {Object}
     * @property {number|Long} [value]
     * @memberof common
     */
    UInt64Value: {
        fields: {
            value: {
                type: "uint64",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.Int32Value message.
     * @interface IInt32Value
     * @type {Object}
     * @property {number} [value]
     * @memberof common
     */
    Int32Value: {
        fields: {
            value: {
                type: "int32",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.UInt32Value message.
     * @interface IUInt32Value
     * @type {Object}
     * @property {number} [value]
     * @memberof common
     */
    UInt32Value: {
        fields: {
            value: {
                type: "uint32",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.BoolValue message.
     * @interface IBoolValue
     * @type {Object}
     * @property {boolean} [value]
     * @memberof common
     */
    BoolValue: {
        fields: {
            value: {
                type: "bool",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.StringValue message.
     * @interface IStringValue
     * @type {Object}
     * @property {string} [value]
     * @memberof common
     */
    StringValue: {
        fields: {
            value: {
                type: "string",
                id: 1
            }
        }
    },

    /**
     * Properties of a google.protobuf.BytesValue message.
     * @interface IBytesValue
     * @type {Object}
     * @property {Uint8Array} [value]
     * @memberof common
     */
    BytesValue: {
        fields: {
            value: {
                type: "bytes",
                id: 1
            }
        }
    }
});

common("field_mask", {

    /**
     * Properties of a google.protobuf.FieldMask message.
     * @interface IDoubleValue
     * @type {Object}
     * @property {number} [value]
     * @memberof common
     */
    FieldMask: {
        fields: {
            paths: {
                rule: "repeated",
                type: "string",
                id: 1
            }
        }
    }
});

/**
 * Gets the root definition of the specified common proto file.
 *
 * Bundled definitions are:
 * - google/protobuf/any.proto
 * - google/protobuf/duration.proto
 * - google/protobuf/empty.proto
 * - google/protobuf/field_mask.proto
 * - google/protobuf/struct.proto
 * - google/protobuf/timestamp.proto
 * - google/protobuf/wrappers.proto
 *
 * @param {string} file Proto file name
 * @returns {INamespace|null} Root definition or `null` if not defined
 */
common.get = function get(file) {
    return common[file] || null;
};

},{}],19:[function(require,module,exports){
"use strict";
/**
 * Runtime message from/to plain object converters.
 * @namespace
 */
var converter = exports;

var Enum = require("./enum"),
    util = require("./util");

/**
 * Generates a partial value fromObject conveter.
 * @param {Codegen} gen Codegen instance
 * @param {Field} field Reflected field
 * @param {number} fieldIndex Field index
 * @param {string} prop Property reference
 * @returns {Codegen} Codegen instance
 * @ignore
 */
function genValuePartial_fromObject(gen, field, fieldIndex, prop) {
    var defaultAlreadyEmitted = false;
    /* eslint-disable no-unexpected-multiline, block-scoped-var, no-redeclare */
    if (field.resolvedType) {
        if (field.resolvedType instanceof Enum) { gen
            ("switch(d%s){", prop);
            for (var values = field.resolvedType.values, keys = Object.keys(values), i = 0; i < keys.length; ++i) {
                // enum unknown values passthrough
                if (values[keys[i]] === field.typeDefault && !defaultAlreadyEmitted) { gen
                    ("default:")
                        ("if(typeof(d%s)===\"number\"){m%s=d%s;break}", prop, prop, prop);
                    if (!field.repeated) gen // fallback to default value only for
                                             // arrays, to avoid leaving holes.
                        ("break");           // for non-repeated fields, just ignore
                    defaultAlreadyEmitted = true;
                }
                gen
                ("case%j:", keys[i])
                ("case %i:", values[keys[i]])
                    ("m%s=%j", prop, values[keys[i]])
                    ("break");
            } gen
            ("}");
        } else gen
            ("if(typeof d%s!==\"object\")", prop)
                ("throw TypeError(%j)", field.fullName + ": object expected")
            ("m%s=types[%i].fromObject(d%s)", prop, fieldIndex, prop);
    } else {
        var isUnsigned = false;
        switch (field.type) {
            case "double":
            case "float": gen
                ("m%s=Number(d%s)", prop, prop); // also catches "NaN", "Infinity"
                break;
            case "uint32":
            case "fixed32": gen
                ("m%s=d%s>>>0", prop, prop);
                break;
            case "int32":
            case "sint32":
            case "sfixed32": gen
                ("m%s=d%s|0", prop, prop);
                break;
            case "uint64":
                isUnsigned = true;
                // eslint-disable-next-line no-fallthrough
            case "int64":
            case "sint64":
            case "fixed64":
            case "sfixed64": gen
                ("if(util.Long)")
                    ("(m%s=util.Long.fromValue(d%s)).unsigned=%j", prop, prop, isUnsigned)
                ("else if(typeof d%s===\"string\")", prop)
                    ("m%s=parseInt(d%s,10)", prop, prop)
                ("else if(typeof d%s===\"number\")", prop)
                    ("m%s=d%s", prop, prop)
                ("else if(typeof d%s===\"object\")", prop)
                    ("m%s=new util.LongBits(d%s.low>>>0,d%s.high>>>0).toNumber(%s)", prop, prop, prop, isUnsigned ? "true" : "");
                break;
            case "bytes": gen
                ("if(typeof d%s===\"string\")", prop)
                    ("util.base64.decode(d%s,m%s=util.newBuffer(util.base64.length(d%s)),0)", prop, prop, prop)
                ("else if(d%s.length >= 0)", prop)
                    ("m%s=d%s", prop, prop);
                break;
            case "string": gen
                ("m%s=String(d%s)", prop, prop);
                break;
            case "bool": gen
                ("m%s=Boolean(d%s)", prop, prop);
                break;
            /* default: gen
                ("m%s=d%s", prop, prop);
                break; */
        }
    }
    return gen;
    /* eslint-enable no-unexpected-multiline, block-scoped-var, no-redeclare */
}

/**
 * Generates a plain object to runtime message converter specific to the specified message type.
 * @param {Type} mtype Message type
 * @returns {Codegen} Codegen instance
 */
converter.fromObject = function fromObject(mtype) {
    /* eslint-disable no-unexpected-multiline, block-scoped-var, no-redeclare */
    var fields = mtype.fieldsArray;
    var gen = util.codegen(["d"], mtype.name + "$fromObject")
    ("if(d instanceof this.ctor)")
        ("return d");
    if (!fields.length) return gen
    ("return new this.ctor");
    gen
    ("var m=new this.ctor");
    for (var i = 0; i < fields.length; ++i) {
        var field  = fields[i].resolve(),
            prop   = util.safeProp(field.name);

        // Map fields
        if (field.map) { gen
    ("if(d%s){", prop)
        ("if(typeof d%s!==\"object\")", prop)
            ("throw TypeError(%j)", field.fullName + ": object expected")
        ("m%s={}", prop)
        ("for(var ks=Object.keys(d%s),i=0;i<ks.length;++i){", prop);
            genValuePartial_fromObject(gen, field, /* not sorted */ i, prop + "[ks[i]]")
        ("}")
    ("}");

        // Repeated fields
        } else if (field.repeated) { gen
    ("if(d%s){", prop)
        ("if(!Array.isArray(d%s))", prop)
            ("throw TypeError(%j)", field.fullName + ": array expected")
        ("m%s=[]", prop)
        ("for(var i=0;i<d%s.length;++i){", prop);
            genValuePartial_fromObject(gen, field, /* not sorted */ i, prop + "[i]")
        ("}")
    ("}");

        // Non-repeated fields
        } else {
            if (!(field.resolvedType instanceof Enum)) gen // no need to test for null/undefined if an enum (uses switch)
    ("if(d%s!=null){", prop); // !== undefined && !== null
        genValuePartial_fromObject(gen, field, /* not sorted */ i, prop);
            if (!(field.resolvedType instanceof Enum)) gen
    ("}");
        }
    } return gen
    ("return m");
    /* eslint-enable no-unexpected-multiline, block-scoped-var, no-redeclare */
};

/**
 * Generates a partial value toObject converter.
 * @param {Codegen} gen Codegen instance
 * @param {Field} field Reflected field
 * @param {number} fieldIndex Field index
 * @param {string} prop Property reference
 * @returns {Codegen} Codegen instance
 * @ignore
 */
function genValuePartial_toObject(gen, field, fieldIndex, prop) {
    /* eslint-disable no-unexpected-multiline, block-scoped-var, no-redeclare */
    if (field.resolvedType) {
        if (field.resolvedType instanceof Enum) gen
            ("d%s=o.enums===String?(types[%i].values[m%s]===undefined?m%s:types[%i].values[m%s]):m%s", prop, fieldIndex, prop, prop, fieldIndex, prop, prop);
        else gen
            ("d%s=types[%i].toObject(m%s,o)", prop, fieldIndex, prop);
    } else {
        var isUnsigned = false;
        switch (field.type) {
            case "double":
            case "float": gen
            ("d%s=o.json&&!isFinite(m%s)?String(m%s):m%s", prop, prop, prop, prop);
                break;
            case "uint64":
                isUnsigned = true;
                // eslint-disable-next-line no-fallthrough
            case "int64":
            case "sint64":
            case "fixed64":
            case "sfixed64": gen
            ("if(typeof m%s===\"number\")", prop)
                ("d%s=o.longs===String?String(m%s):m%s", prop, prop, prop)
            ("else") // Long-like
                ("d%s=o.longs===String?util.Long.prototype.toString.call(m%s):o.longs===Number?new util.LongBits(m%s.low>>>0,m%s.high>>>0).toNumber(%s):m%s", prop, prop, prop, prop, isUnsigned ? "true": "", prop);
                break;
            case "bytes": gen
            ("d%s=o.bytes===String?util.base64.encode(m%s,0,m%s.length):o.bytes===Array?Array.prototype.slice.call(m%s):m%s", prop, prop, prop, prop, prop);
                break;
            default: gen
            ("d%s=m%s", prop, prop);
                break;
        }
    }
    return gen;
    /* eslint-enable no-unexpected-multiline, block-scoped-var, no-redeclare */
}

/**
 * Generates a runtime message to plain object converter specific to the specified message type.
 * @param {Type} mtype Message type
 * @returns {Codegen} Codegen instance
 */
converter.toObject = function toObject(mtype) {
    /* eslint-disable no-unexpected-multiline, block-scoped-var, no-redeclare */
    var fields = mtype.fieldsArray.slice().sort(util.compareFieldsById);
    if (!fields.length)
        return util.codegen()("return {}");
    var gen = util.codegen(["m", "o"], mtype.name + "$toObject")
    ("if(!o)")
        ("o={}")
    ("var d={}");

    var repeatedFields = [],
        mapFields = [],
        normalFields = [],
        i = 0;
    for (; i < fields.length; ++i)
        if (!fields[i].partOf)
            ( fields[i].resolve().repeated ? repeatedFields
            : fields[i].map ? mapFields
            : normalFields).push(fields[i]);

    if (repeatedFields.length) { gen
    ("if(o.arrays||o.defaults){");
        for (i = 0; i < repeatedFields.length; ++i) gen
        ("d%s=[]", util.safeProp(repeatedFields[i].name));
        gen
    ("}");
    }

    if (mapFields.length) { gen
    ("if(o.objects||o.defaults){");
        for (i = 0; i < mapFields.length; ++i) gen
        ("d%s={}", util.safeProp(mapFields[i].name));
        gen
    ("}");
    }

    if (normalFields.length) { gen
    ("if(o.defaults){");
        for (i = 0; i < normalFields.length; ++i) {
            var field = normalFields[i],
                prop  = util.safeProp(field.name);
            if (field.resolvedType instanceof Enum) gen
        ("d%s=o.enums===String?%j:%j", prop, field.resolvedType.valuesById[field.typeDefault], field.typeDefault);
            else if (field.long) gen
        ("if(util.Long){")
            ("var n=new util.Long(%i,%i,%j)", field.typeDefault.low, field.typeDefault.high, field.typeDefault.unsigned)
            ("d%s=o.longs===String?n.toString():o.longs===Number?n.toNumber():n", prop)
        ("}else")
            ("d%s=o.longs===String?%j:%i", prop, field.typeDefault.toString(), field.typeDefault.toNumber());
            else if (field.bytes) {
                var arrayDefault = "[" + Array.prototype.slice.call(field.typeDefault).join(",") + "]";
                gen
        ("if(o.bytes===String)d%s=%j", prop, String.fromCharCode.apply(String, field.typeDefault))
        ("else{")
            ("d%s=%s", prop, arrayDefault)
            ("if(o.bytes!==Array)d%s=util.newBuffer(d%s)", prop, prop)
        ("}");
            } else gen
        ("d%s=%j", prop, field.typeDefault); // also messages (=null)
        } gen
    ("}");
    }
    var hasKs2 = false;
    for (i = 0; i < fields.length; ++i) {
        var field = fields[i],
            index = mtype._fieldsArray.indexOf(field),
            prop  = util.safeProp(field.name);
        if (field.map) {
            if (!hasKs2) { hasKs2 = true; gen
    ("var ks2");
            } gen
    ("if(m%s&&(ks2=Object.keys(m%s)).length){", prop, prop)
        ("d%s={}", prop)
        ("for(var j=0;j<ks2.length;++j){");
            genValuePartial_toObject(gen, field, /* sorted */ index, prop + "[ks2[j]]")
        ("}");
        } else if (field.repeated) { gen
    ("if(m%s&&m%s.length){", prop, prop)
        ("d%s=[]", prop)
        ("for(var j=0;j<m%s.length;++j){", prop);
            genValuePartial_toObject(gen, field, /* sorted */ index, prop + "[j]")
        ("}");
        } else { gen
    ("if(m%s!=null&&m.hasOwnProperty(%j)){", prop, field.name); // !== undefined && !== null
        genValuePartial_toObject(gen, field, /* sorted */ index, prop);
        if (field.partOf) gen
        ("if(o.oneofs)")
            ("d%s=%j", util.safeProp(field.partOf.name), field.name);
        }
        gen
    ("}");
    }
    return gen
    ("return d");
    /* eslint-enable no-unexpected-multiline, block-scoped-var, no-redeclare */
};

},{"./enum":22,"./util":44}],20:[function(require,module,exports){
"use strict";
module.exports = decoder;

var Enum    = require("./enum"),
    types   = require("./types"),
    util    = require("./util");

function missing(field) {
    return "missing required '" + field.name + "'";
}

/**
 * Generates a decoder specific to the specified message type.
 * @param {Type} mtype Message type
 * @returns {Codegen} Codegen instance
 */
function decoder(mtype) {
    /* eslint-disable no-unexpected-multiline */
    var gen = util.codegen(["r", "l"], mtype.name + "$decode")
    ("if(!(r instanceof Reader))")
        ("r=Reader.create(r)")
    ("var c=l===undefined?r.len:r.pos+l,m=new this.ctor" + (mtype.fieldsArray.filter(function(field) { return field.map; }).length ? ",k,value" : ""))
    ("while(r.pos<c){")
        ("var t=r.uint32()");
    if (mtype.group) gen
        ("if((t&7)===4)")
            ("break");
    gen
        ("switch(t>>>3){");

    var i = 0;
    for (; i < /* initializes */ mtype.fieldsArray.length; ++i) {
        var field = mtype._fieldsArray[i].resolve(),
            type  = field.resolvedType instanceof Enum ? "int32" : field.type,
            ref   = "m" + util.safeProp(field.name); gen
            ("case %i: {", field.id);

        // Map fields
        if (field.map) { gen
                ("if(%s===util.emptyObject)", ref)
                    ("%s={}", ref)
                ("var c2 = r.uint32()+r.pos");

            if (types.defaults[field.keyType] !== undefined) gen
                ("k=%j", types.defaults[field.keyType]);
            else gen
                ("k=null");

            if (types.defaults[type] !== undefined) gen
                ("value=%j", types.defaults[type]);
            else gen
                ("value=null");

            gen
                ("while(r.pos<c2){")
                    ("var tag2=r.uint32()")
                    ("switch(tag2>>>3){")
                        ("case 1: k=r.%s(); break", field.keyType)
                        ("case 2:");

            if (types.basic[type] === undefined) gen
                            ("value=types[%i].decode(r,r.uint32())", i); // can't be groups
            else gen
                            ("value=r.%s()", type);

            gen
                            ("break")
                        ("default:")
                            ("r.skipType(tag2&7)")
                            ("break")
                    ("}")
                ("}");

            if (types.long[field.keyType] !== undefined) gen
                ("%s[typeof k===\"object\"?util.longToHash(k):k]=value", ref);
            else gen
                ("%s[k]=value", ref);

        // Repeated fields
        } else if (field.repeated) { gen

                ("if(!(%s&&%s.length))", ref, ref)
                    ("%s=[]", ref);

            // Packable (always check for forward and backward compatiblity)
            if (types.packed[type] !== undefined) gen
                ("if((t&7)===2){")
                    ("var c2=r.uint32()+r.pos")
                    ("while(r.pos<c2)")
                        ("%s.push(r.%s())", ref, type)
                ("}else");

            // Non-packed
            if (types.basic[type] === undefined) gen(field.resolvedType.group
                    ? "%s.push(types[%i].decode(r))"
                    : "%s.push(types[%i].decode(r,r.uint32()))", ref, i);
            else gen
                    ("%s.push(r.%s())", ref, type);

        // Non-repeated
        } else if (types.basic[type] === undefined) gen(field.resolvedType.group
                ? "%s=types[%i].decode(r)"
                : "%s=types[%i].decode(r,r.uint32())", ref, i);
        else gen
                ("%s=r.%s()", ref, type);
        gen
                ("break")
            ("}");
        // Unknown fields
    } gen
            ("default:")
                ("r.skipType(t&7)")
                ("break")

        ("}")
    ("}");

    // Field presence
    for (i = 0; i < mtype._fieldsArray.length; ++i) {
        var rfield = mtype._fieldsArray[i];
        if (rfield.required) gen
    ("if(!m.hasOwnProperty(%j))", rfield.name)
        ("throw util.ProtocolError(%j,{instance:m})", missing(rfield));
    }

    return gen
    ("return m");
    /* eslint-enable no-unexpected-multiline */
}

},{"./enum":22,"./types":43,"./util":44}],21:[function(require,module,exports){
"use strict";
module.exports = encoder;

var Enum     = require("./enum"),
    types    = require("./types"),
    util     = require("./util");

/**
 * Generates a partial message type encoder.
 * @param {Codegen} gen Codegen instance
 * @param {Field} field Reflected field
 * @param {number} fieldIndex Field index
 * @param {string} ref Variable reference
 * @returns {Codegen} Codegen instance
 * @ignore
 */
function genTypePartial(gen, field, fieldIndex, ref) {
    return field.resolvedType.group
        ? gen("types[%i].encode(%s,w.uint32(%i)).uint32(%i)", fieldIndex, ref, (field.id << 3 | 3) >>> 0, (field.id << 3 | 4) >>> 0)
        : gen("types[%i].encode(%s,w.uint32(%i).fork()).ldelim()", fieldIndex, ref, (field.id << 3 | 2) >>> 0);
}

/**
 * Generates an encoder specific to the specified message type.
 * @param {Type} mtype Message type
 * @returns {Codegen} Codegen instance
 */
function encoder(mtype) {
    /* eslint-disable no-unexpected-multiline, block-scoped-var, no-redeclare */
    var gen = util.codegen(["m", "w"], mtype.name + "$encode")
    ("if(!w)")
        ("w=Writer.create()");

    var i, ref;

    // "when a message is serialized its known fields should be written sequentially by field number"
    var fields = /* initializes */ mtype.fieldsArray.slice().sort(util.compareFieldsById);

    for (var i = 0; i < fields.length; ++i) {
        var field    = fields[i].resolve(),
            index    = mtype._fieldsArray.indexOf(field),
            type     = field.resolvedType instanceof Enum ? "int32" : field.type,
            wireType = types.basic[type];
            ref      = "m" + util.safeProp(field.name);

        // Map fields
        if (field.map) {
            gen
    ("if(%s!=null&&Object.hasOwnProperty.call(m,%j)){", ref, field.name) // !== undefined && !== null
        ("for(var ks=Object.keys(%s),i=0;i<ks.length;++i){", ref)
            ("w.uint32(%i).fork().uint32(%i).%s(ks[i])", (field.id << 3 | 2) >>> 0, 8 | types.mapKey[field.keyType], field.keyType);
            if (wireType === undefined) gen
            ("types[%i].encode(%s[ks[i]],w.uint32(18).fork()).ldelim().ldelim()", index, ref); // can't be groups
            else gen
            (".uint32(%i).%s(%s[ks[i]]).ldelim()", 16 | wireType, type, ref);
            gen
        ("}")
    ("}");

            // Repeated fields
        } else if (field.repeated) { gen
    ("if(%s!=null&&%s.length){", ref, ref); // !== undefined && !== null

            // Packed repeated
            if (field.packed && types.packed[type] !== undefined) { gen

        ("w.uint32(%i).fork()", (field.id << 3 | 2) >>> 0)
        ("for(var i=0;i<%s.length;++i)", ref)
            ("w.%s(%s[i])", type, ref)
        ("w.ldelim()");

            // Non-packed
            } else { gen

        ("for(var i=0;i<%s.length;++i)", ref);
                if (wireType === undefined)
            genTypePartial(gen, field, index, ref + "[i]");
                else gen
            ("w.uint32(%i).%s(%s[i])", (field.id << 3 | wireType) >>> 0, type, ref);

            } gen
    ("}");

        // Non-repeated
        } else {
            if (field.optional) gen
    ("if(%s!=null&&Object.hasOwnProperty.call(m,%j))", ref, field.name); // !== undefined && !== null

            if (wireType === undefined)
        genTypePartial(gen, field, index, ref);
            else gen
        ("w.uint32(%i).%s(%s)", (field.id << 3 | wireType) >>> 0, type, ref);

        }
    }

    return gen
    ("return w");
    /* eslint-enable no-unexpected-multiline, block-scoped-var, no-redeclare */
}

},{"./enum":22,"./types":43,"./util":44}],22:[function(require,module,exports){
"use strict";
module.exports = Enum;

// extends ReflectionObject
var ReflectionObject = require("./object");
((Enum.prototype = Object.create(ReflectionObject.prototype)).constructor = Enum).className = "Enum";

var Namespace = require("./namespace"),
    util = require("./util");

/**
 * Constructs a new enum instance.
 * @classdesc Reflected enum.
 * @extends ReflectionObject
 * @constructor
 * @param {string} name Unique name within its namespace
 * @param {Object.<string,number>} [values] Enum values as an object, by name
 * @param {Object.<string,*>} [options] Declared options
 * @param {string} [comment] The comment for this enum
 * @param {Object.<string,string>} [comments] The value comments for this enum
 * @param {Object.<string,Object<string,*>>|undefined} [valuesOptions] The value options for this enum
 */
function Enum(name, values, options, comment, comments, valuesOptions) {
    ReflectionObject.call(this, name, options);

    if (values && typeof values !== "object")
        throw TypeError("values must be an object");

    /**
     * Enum values by id.
     * @type {Object.<number,string>}
     */
    this.valuesById = {};

    /**
     * Enum values by name.
     * @type {Object.<string,number>}
     */
    this.values = Object.create(this.valuesById); // toJSON, marker

    /**
     * Enum comment text.
     * @type {string|null}
     */
    this.comment = comment;

    /**
     * Value comment texts, if any.
     * @type {Object.<string,string>}
     */
    this.comments = comments || {};

    /**
     * Values options, if any
     * @type {Object<string, Object<string, *>>|undefined}
     */
    this.valuesOptions = valuesOptions;

    /**
     * Reserved ranges, if any.
     * @type {Array.<number[]|string>}
     */
    this.reserved = undefined; // toJSON

    // Note that values inherit valuesById on their prototype which makes them a TypeScript-
    // compatible enum. This is used by pbts to write actual enum definitions that work for
    // static and reflection code alike instead of emitting generic object definitions.

    if (values)
        for (var keys = Object.keys(values), i = 0; i < keys.length; ++i)
            if (typeof values[keys[i]] === "number") // use forward entries only
                this.valuesById[ this.values[keys[i]] = values[keys[i]] ] = keys[i];
}

/**
 * Enum descriptor.
 * @interface IEnum
 * @property {Object.<string,number>} values Enum values
 * @property {Object.<string,*>} [options] Enum options
 */

/**
 * Constructs an enum from an enum descriptor.
 * @param {string} name Enum name
 * @param {IEnum} json Enum descriptor
 * @returns {Enum} Created enum
 * @throws {TypeError} If arguments are invalid
 */
Enum.fromJSON = function fromJSON(name, json) {
    var enm = new Enum(name, json.values, json.options, json.comment, json.comments);
    enm.reserved = json.reserved;
    return enm;
};

/**
 * Converts this enum to an enum descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IEnum} Enum descriptor
 */
Enum.prototype.toJSON = function toJSON(toJSONOptions) {
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "options"       , this.options,
        "valuesOptions" , this.valuesOptions,
        "values"        , this.values,
        "reserved"      , this.reserved && this.reserved.length ? this.reserved : undefined,
        "comment"       , keepComments ? this.comment : undefined,
        "comments"      , keepComments ? this.comments : undefined
    ]);
};

/**
 * Adds a value to this enum.
 * @param {string} name Value name
 * @param {number} id Value id
 * @param {string} [comment] Comment, if any
 * @param {Object.<string, *>|undefined} [options] Options, if any
 * @returns {Enum} `this`
 * @throws {TypeError} If arguments are invalid
 * @throws {Error} If there is already a value with this name or id
 */
Enum.prototype.add = function add(name, id, comment, options) {
    // utilized by the parser but not by .fromJSON

    if (!util.isString(name))
        throw TypeError("name must be a string");

    if (!util.isInteger(id))
        throw TypeError("id must be an integer");

    if (this.values[name] !== undefined)
        throw Error("duplicate name '" + name + "' in " + this);

    if (this.isReservedId(id))
        throw Error("id " + id + " is reserved in " + this);

    if (this.isReservedName(name))
        throw Error("name '" + name + "' is reserved in " + this);

    if (this.valuesById[id] !== undefined) {
        if (!(this.options && this.options.allow_alias))
            throw Error("duplicate id " + id + " in " + this);
        this.values[name] = id;
    } else
        this.valuesById[this.values[name] = id] = name;

    if (options) {
        if (this.valuesOptions === undefined)
            this.valuesOptions = {};
        this.valuesOptions[name] = options || null;
    }

    this.comments[name] = comment || null;
    return this;
};

/**
 * Removes a value from this enum
 * @param {string} name Value name
 * @returns {Enum} `this`
 * @throws {TypeError} If arguments are invalid
 * @throws {Error} If `name` is not a name of this enum
 */
Enum.prototype.remove = function remove(name) {

    if (!util.isString(name))
        throw TypeError("name must be a string");

    var val = this.values[name];
    if (val == null)
        throw Error("name '" + name + "' does not exist in " + this);

    delete this.valuesById[val];
    delete this.values[name];
    delete this.comments[name];
    if (this.valuesOptions)
        delete this.valuesOptions[name];

    return this;
};

/**
 * Tests if the specified id is reserved.
 * @param {number} id Id to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
Enum.prototype.isReservedId = function isReservedId(id) {
    return Namespace.isReservedId(this.reserved, id);
};

/**
 * Tests if the specified name is reserved.
 * @param {string} name Name to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
Enum.prototype.isReservedName = function isReservedName(name) {
    return Namespace.isReservedName(this.reserved, name);
};

},{"./namespace":30,"./object":31,"./util":44}],23:[function(require,module,exports){
"use strict";
module.exports = Field;

// extends ReflectionObject
var ReflectionObject = require("./object");
((Field.prototype = Object.create(ReflectionObject.prototype)).constructor = Field).className = "Field";

var Enum  = require("./enum"),
    types = require("./types"),
    util  = require("./util");

var Type; // cyclic

var ruleRe = /^required|optional|repeated$/;

/**
 * Constructs a new message field instance. Note that {@link MapField|map fields} have their own class.
 * @name Field
 * @classdesc Reflected message field.
 * @extends FieldBase
 * @constructor
 * @param {string} name Unique name within its namespace
 * @param {number} id Unique id within its namespace
 * @param {string} type Value type
 * @param {string|Object.<string,*>} [rule="optional"] Field rule
 * @param {string|Object.<string,*>} [extend] Extended type if different from parent
 * @param {Object.<string,*>} [options] Declared options
 */

/**
 * Constructs a field from a field descriptor.
 * @param {string} name Field name
 * @param {IField} json Field descriptor
 * @returns {Field} Created field
 * @throws {TypeError} If arguments are invalid
 */
Field.fromJSON = function fromJSON(name, json) {
    return new Field(name, json.id, json.type, json.rule, json.extend, json.options, json.comment);
};

/**
 * Not an actual constructor. Use {@link Field} instead.
 * @classdesc Base class of all reflected message fields. This is not an actual class but here for the sake of having consistent type definitions.
 * @exports FieldBase
 * @extends ReflectionObject
 * @constructor
 * @param {string} name Unique name within its namespace
 * @param {number} id Unique id within its namespace
 * @param {string} type Value type
 * @param {string|Object.<string,*>} [rule="optional"] Field rule
 * @param {string|Object.<string,*>} [extend] Extended type if different from parent
 * @param {Object.<string,*>} [options] Declared options
 * @param {string} [comment] Comment associated with this field
 */
function Field(name, id, type, rule, extend, options, comment) {

    if (util.isObject(rule)) {
        comment = extend;
        options = rule;
        rule = extend = undefined;
    } else if (util.isObject(extend)) {
        comment = options;
        options = extend;
        extend = undefined;
    }

    ReflectionObject.call(this, name, options);

    if (!util.isInteger(id) || id < 0)
        throw TypeError("id must be a non-negative integer");

    if (!util.isString(type))
        throw TypeError("type must be a string");

    if (rule !== undefined && !ruleRe.test(rule = rule.toString().toLowerCase()))
        throw TypeError("rule must be a string rule");

    if (extend !== undefined && !util.isString(extend))
        throw TypeError("extend must be a string");

    /**
     * Field rule, if any.
     * @type {string|undefined}
     */
    if (rule === "proto3_optional") {
        rule = "optional";
    }
    this.rule = rule && rule !== "optional" ? rule : undefined; // toJSON

    /**
     * Field type.
     * @type {string}
     */
    this.type = type; // toJSON

    /**
     * Unique field id.
     * @type {number}
     */
    this.id = id; // toJSON, marker

    /**
     * Extended type if different from parent.
     * @type {string|undefined}
     */
    this.extend = extend || undefined; // toJSON

    /**
     * Whether this field is required.
     * @type {boolean}
     */
    this.required = rule === "required";

    /**
     * Whether this field is optional.
     * @type {boolean}
     */
    this.optional = !this.required;

    /**
     * Whether this field is repeated.
     * @type {boolean}
     */
    this.repeated = rule === "repeated";

    /**
     * Whether this field is a map or not.
     * @type {boolean}
     */
    this.map = false;

    /**
     * Message this field belongs to.
     * @type {Type|null}
     */
    this.message = null;

    /**
     * OneOf this field belongs to, if any,
     * @type {OneOf|null}
     */
    this.partOf = null;

    /**
     * The field type's default value.
     * @type {*}
     */
    this.typeDefault = null;

    /**
     * The field's default value on prototypes.
     * @type {*}
     */
    this.defaultValue = null;

    /**
     * Whether this field's value should be treated as a long.
     * @type {boolean}
     */
    this.long = util.Long ? types.long[type] !== undefined : /* istanbul ignore next */ false;

    /**
     * Whether this field's value is a buffer.
     * @type {boolean}
     */
    this.bytes = type === "bytes";

    /**
     * Resolved type if not a basic type.
     * @type {Type|Enum|null}
     */
    this.resolvedType = null;

    /**
     * Sister-field within the extended type if a declaring extension field.
     * @type {Field|null}
     */
    this.extensionField = null;

    /**
     * Sister-field within the declaring namespace if an extended field.
     * @type {Field|null}
     */
    this.declaringField = null;

    /**
     * Internally remembers whether this field is packed.
     * @type {boolean|null}
     * @private
     */
    this._packed = null;

    /**
     * Comment for this field.
     * @type {string|null}
     */
    this.comment = comment;
}

/**
 * Determines whether this field is packed. Only relevant when repeated and working with proto2.
 * @name Field#packed
 * @type {boolean}
 * @readonly
 */
Object.defineProperty(Field.prototype, "packed", {
    get: function() {
        // defaults to packed=true if not explicity set to false
        if (this._packed === null)
            this._packed = this.getOption("packed") !== false;
        return this._packed;
    }
});

/**
 * @override
 */
Field.prototype.setOption = function setOption(name, value, ifNotSet) {
    if (name === "packed") // clear cached before setting
        this._packed = null;
    return ReflectionObject.prototype.setOption.call(this, name, value, ifNotSet);
};

/**
 * Field descriptor.
 * @interface IField
 * @property {string} [rule="optional"] Field rule
 * @property {string} type Field type
 * @property {number} id Field id
 * @property {Object.<string,*>} [options] Field options
 */

/**
 * Extension field descriptor.
 * @interface IExtensionField
 * @extends IField
 * @property {string} extend Extended type
 */

/**
 * Converts this field to a field descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IField} Field descriptor
 */
Field.prototype.toJSON = function toJSON(toJSONOptions) {
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "rule"    , this.rule !== "optional" && this.rule || undefined,
        "type"    , this.type,
        "id"      , this.id,
        "extend"  , this.extend,
        "options" , this.options,
        "comment" , keepComments ? this.comment : undefined
    ]);
};

/**
 * Resolves this field's type references.
 * @returns {Field} `this`
 * @throws {Error} If any reference cannot be resolved
 */
Field.prototype.resolve = function resolve() {

    if (this.resolved)
        return this;

    if ((this.typeDefault = types.defaults[this.type]) === undefined) { // if not a basic type, resolve it
        this.resolvedType = (this.declaringField ? this.declaringField.parent : this.parent).lookupTypeOrEnum(this.type);
        if (this.resolvedType instanceof Type)
            this.typeDefault = null;
        else // instanceof Enum
            this.typeDefault = this.resolvedType.values[Object.keys(this.resolvedType.values)[0]]; // first defined
    } else if (this.options && this.options.proto3_optional) {
        // proto3 scalar value marked optional; should default to null
        this.typeDefault = null;
    }

    // use explicitly set default value if present
    if (this.options && this.options["default"] != null) {
        this.typeDefault = this.options["default"];
        if (this.resolvedType instanceof Enum && typeof this.typeDefault === "string")
            this.typeDefault = this.resolvedType.values[this.typeDefault];
    }

    // remove unnecessary options
    if (this.options) {
        if (this.options.packed === true || this.options.packed !== undefined && this.resolvedType && !(this.resolvedType instanceof Enum))
            delete this.options.packed;
        if (!Object.keys(this.options).length)
            this.options = undefined;
    }

    // convert to internal data type if necesssary
    if (this.long) {
        this.typeDefault = util.Long.fromNumber(this.typeDefault, this.type.charAt(0) === "u");

        /* istanbul ignore else */
        if (Object.freeze)
            Object.freeze(this.typeDefault); // long instances are meant to be immutable anyway (i.e. use small int cache that even requires it)

    } else if (this.bytes && typeof this.typeDefault === "string") {
        var buf;
        if (util.base64.test(this.typeDefault))
            util.base64.decode(this.typeDefault, buf = util.newBuffer(util.base64.length(this.typeDefault)), 0);
        else
            util.utf8.write(this.typeDefault, buf = util.newBuffer(util.utf8.length(this.typeDefault)), 0);
        this.typeDefault = buf;
    }

    // take special care of maps and repeated fields
    if (this.map)
        this.defaultValue = util.emptyObject;
    else if (this.repeated)
        this.defaultValue = util.emptyArray;
    else
        this.defaultValue = this.typeDefault;

    // ensure proper value on prototype
    if (this.parent instanceof Type)
        this.parent.ctor.prototype[this.name] = this.defaultValue;

    return ReflectionObject.prototype.resolve.call(this);
};

/**
 * Decorator function as returned by {@link Field.d} and {@link MapField.d} (TypeScript).
 * @typedef FieldDecorator
 * @type {function}
 * @param {Object} prototype Target prototype
 * @param {string} fieldName Field name
 * @returns {undefined}
 */

/**
 * Field decorator (TypeScript).
 * @name Field.d
 * @function
 * @param {number} fieldId Field id
 * @param {"double"|"float"|"int32"|"uint32"|"sint32"|"fixed32"|"sfixed32"|"int64"|"uint64"|"sint64"|"fixed64"|"sfixed64"|"string"|"bool"|"bytes"|Object} fieldType Field type
 * @param {"optional"|"required"|"repeated"} [fieldRule="optional"] Field rule
 * @param {T} [defaultValue] Default value
 * @returns {FieldDecorator} Decorator function
 * @template T extends number | number[] | Long | Long[] | string | string[] | boolean | boolean[] | Uint8Array | Uint8Array[] | Buffer | Buffer[]
 */
Field.d = function decorateField(fieldId, fieldType, fieldRule, defaultValue) {

    // submessage: decorate the submessage and use its name as the type
    if (typeof fieldType === "function")
        fieldType = util.decorateType(fieldType).name;

    // enum reference: create a reflected copy of the enum and keep reuseing it
    else if (fieldType && typeof fieldType === "object")
        fieldType = util.decorateEnum(fieldType).name;

    return function fieldDecorator(prototype, fieldName) {
        util.decorateType(prototype.constructor)
            .add(new Field(fieldName, fieldId, fieldType, fieldRule, { "default": defaultValue }));
    };
};

/**
 * Field decorator (TypeScript).
 * @name Field.d
 * @function
 * @param {number} fieldId Field id
 * @param {Constructor<T>|string} fieldType Field type
 * @param {"optional"|"required"|"repeated"} [fieldRule="optional"] Field rule
 * @returns {FieldDecorator} Decorator function
 * @template T extends Message<T>
 * @variation 2
 */
// like Field.d but without a default value

// Sets up cyclic dependencies (called in index-light)
Field._configure = function configure(Type_) {
    Type = Type_;
};

},{"./enum":22,"./object":31,"./types":43,"./util":44}],24:[function(require,module,exports){
"use strict";
var protobuf = module.exports = require("./index-minimal");

protobuf.build = "light";

/**
 * A node-style callback as used by {@link load} and {@link Root#load}.
 * @typedef LoadCallback
 * @type {function}
 * @param {Error|null} error Error, if any, otherwise `null`
 * @param {Root} [root] Root, if there hasn't been an error
 * @returns {undefined}
 */

/**
 * Loads one or multiple .proto or preprocessed .json files into a common root namespace and calls the callback.
 * @param {string|string[]} filename One or multiple files to load
 * @param {Root} root Root namespace, defaults to create a new one if omitted.
 * @param {LoadCallback} callback Callback function
 * @returns {undefined}
 * @see {@link Root#load}
 */
function load(filename, root, callback) {
    if (typeof root === "function") {
        callback = root;
        root = new protobuf.Root();
    } else if (!root)
        root = new protobuf.Root();
    return root.load(filename, callback);
}

/**
 * Loads one or multiple .proto or preprocessed .json files into a common root namespace and calls the callback.
 * @name load
 * @function
 * @param {string|string[]} filename One or multiple files to load
 * @param {LoadCallback} callback Callback function
 * @returns {undefined}
 * @see {@link Root#load}
 * @variation 2
 */
// function load(filename:string, callback:LoadCallback):undefined

/**
 * Loads one or multiple .proto or preprocessed .json files into a common root namespace and returns a promise.
 * @name load
 * @function
 * @param {string|string[]} filename One or multiple files to load
 * @param {Root} [root] Root namespace, defaults to create a new one if omitted.
 * @returns {Promise<Root>} Promise
 * @see {@link Root#load}
 * @variation 3
 */
// function load(filename:string, [root:Root]):Promise<Root>

protobuf.load = load;

/**
 * Synchronously loads one or multiple .proto or preprocessed .json files into a common root namespace (node only).
 * @param {string|string[]} filename One or multiple files to load
 * @param {Root} [root] Root namespace, defaults to create a new one if omitted.
 * @returns {Root} Root namespace
 * @throws {Error} If synchronous fetching is not supported (i.e. in browsers) or if a file's syntax is invalid
 * @see {@link Root#loadSync}
 */
function loadSync(filename, root) {
    if (!root)
        root = new protobuf.Root();
    return root.loadSync(filename);
}

protobuf.loadSync = loadSync;

// Serialization
protobuf.encoder          = require("./encoder");
protobuf.decoder          = require("./decoder");
protobuf.verifier         = require("./verifier");
protobuf.converter        = require("./converter");

// Reflection
protobuf.ReflectionObject = require("./object");
protobuf.Namespace        = require("./namespace");
protobuf.Root             = require("./root");
protobuf.Enum             = require("./enum");
protobuf.Type             = require("./type");
protobuf.Field            = require("./field");
protobuf.OneOf            = require("./oneof");
protobuf.MapField         = require("./mapfield");
protobuf.Service          = require("./service");
protobuf.Method           = require("./method");

// Runtime
protobuf.Message          = require("./message");
protobuf.wrappers         = require("./wrappers");

// Utility
protobuf.types            = require("./types");
protobuf.util             = require("./util");

// Set up possibly cyclic reflection dependencies
protobuf.ReflectionObject._configure(protobuf.Root);
protobuf.Namespace._configure(protobuf.Type, protobuf.Service, protobuf.Enum);
protobuf.Root._configure(protobuf.Type);
protobuf.Field._configure(protobuf.Type);

},{"./converter":19,"./decoder":20,"./encoder":21,"./enum":22,"./field":23,"./index-minimal":25,"./mapfield":27,"./message":28,"./method":29,"./namespace":30,"./object":31,"./oneof":32,"./root":36,"./service":40,"./type":42,"./types":43,"./util":44,"./verifier":47,"./wrappers":48}],25:[function(require,module,exports){
"use strict";
var protobuf = exports;

/**
 * Build type, one of `"full"`, `"light"` or `"minimal"`.
 * @name build
 * @type {string}
 * @const
 */
protobuf.build = "minimal";

// Serialization
protobuf.Writer       = require("./writer");
protobuf.BufferWriter = require("./writer_buffer");
protobuf.Reader       = require("./reader");
protobuf.BufferReader = require("./reader_buffer");

// Utility
protobuf.util         = require("./util/minimal");
protobuf.rpc          = require("./rpc");
protobuf.roots        = require("./roots");
protobuf.configure    = configure;

/* istanbul ignore next */
/**
 * Reconfigures the library according to the environment.
 * @returns {undefined}
 */
function configure() {
    protobuf.util._configure();
    protobuf.Writer._configure(protobuf.BufferWriter);
    protobuf.Reader._configure(protobuf.BufferReader);
}

// Set up buffer utility according to the environment
configure();

},{"./reader":34,"./reader_buffer":35,"./roots":37,"./rpc":38,"./util/minimal":46,"./writer":49,"./writer_buffer":50}],26:[function(require,module,exports){
"use strict";
var protobuf = module.exports = require("./index-light");

protobuf.build = "full";

// Parser
protobuf.tokenize         = require("./tokenize");
protobuf.parse            = require("./parse");
protobuf.common           = require("./common");

// Configure parser
protobuf.Root._configure(protobuf.Type, protobuf.parse, protobuf.common);

},{"./common":18,"./index-light":24,"./parse":33,"./tokenize":41}],27:[function(require,module,exports){
"use strict";
module.exports = MapField;

// extends Field
var Field = require("./field");
((MapField.prototype = Object.create(Field.prototype)).constructor = MapField).className = "MapField";

var types   = require("./types"),
    util    = require("./util");

/**
 * Constructs a new map field instance.
 * @classdesc Reflected map field.
 * @extends FieldBase
 * @constructor
 * @param {string} name Unique name within its namespace
 * @param {number} id Unique id within its namespace
 * @param {string} keyType Key type
 * @param {string} type Value type
 * @param {Object.<string,*>} [options] Declared options
 * @param {string} [comment] Comment associated with this field
 */
function MapField(name, id, keyType, type, options, comment) {
    Field.call(this, name, id, type, undefined, undefined, options, comment);

    /* istanbul ignore if */
    if (!util.isString(keyType))
        throw TypeError("keyType must be a string");

    /**
     * Key type.
     * @type {string}
     */
    this.keyType = keyType; // toJSON, marker

    /**
     * Resolved key type if not a basic type.
     * @type {ReflectionObject|null}
     */
    this.resolvedKeyType = null;

    // Overrides Field#map
    this.map = true;
}

/**
 * Map field descriptor.
 * @interface IMapField
 * @extends {IField}
 * @property {string} keyType Key type
 */

/**
 * Extension map field descriptor.
 * @interface IExtensionMapField
 * @extends IMapField
 * @property {string} extend Extended type
 */

/**
 * Constructs a map field from a map field descriptor.
 * @param {string} name Field name
 * @param {IMapField} json Map field descriptor
 * @returns {MapField} Created map field
 * @throws {TypeError} If arguments are invalid
 */
MapField.fromJSON = function fromJSON(name, json) {
    return new MapField(name, json.id, json.keyType, json.type, json.options, json.comment);
};

/**
 * Converts this map field to a map field descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IMapField} Map field descriptor
 */
MapField.prototype.toJSON = function toJSON(toJSONOptions) {
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "keyType" , this.keyType,
        "type"    , this.type,
        "id"      , this.id,
        "extend"  , this.extend,
        "options" , this.options,
        "comment" , keepComments ? this.comment : undefined
    ]);
};

/**
 * @override
 */
MapField.prototype.resolve = function resolve() {
    if (this.resolved)
        return this;

    // Besides a value type, map fields have a key type that may be "any scalar type except for floating point types and bytes"
    if (types.mapKey[this.keyType] === undefined)
        throw Error("invalid key type: " + this.keyType);

    return Field.prototype.resolve.call(this);
};

/**
 * Map field decorator (TypeScript).
 * @name MapField.d
 * @function
 * @param {number} fieldId Field id
 * @param {"int32"|"uint32"|"sint32"|"fixed32"|"sfixed32"|"int64"|"uint64"|"sint64"|"fixed64"|"sfixed64"|"bool"|"string"} fieldKeyType Field key type
 * @param {"double"|"float"|"int32"|"uint32"|"sint32"|"fixed32"|"sfixed32"|"int64"|"uint64"|"sint64"|"fixed64"|"sfixed64"|"bool"|"string"|"bytes"|Object|Constructor<{}>} fieldValueType Field value type
 * @returns {FieldDecorator} Decorator function
 * @template T extends { [key: string]: number | Long | string | boolean | Uint8Array | Buffer | number[] | Message<{}> }
 */
MapField.d = function decorateMapField(fieldId, fieldKeyType, fieldValueType) {

    // submessage value: decorate the submessage and use its name as the type
    if (typeof fieldValueType === "function")
        fieldValueType = util.decorateType(fieldValueType).name;

    // enum reference value: create a reflected copy of the enum and keep reuseing it
    else if (fieldValueType && typeof fieldValueType === "object")
        fieldValueType = util.decorateEnum(fieldValueType).name;

    return function mapFieldDecorator(prototype, fieldName) {
        util.decorateType(prototype.constructor)
            .add(new MapField(fieldName, fieldId, fieldKeyType, fieldValueType));
    };
};

},{"./field":23,"./types":43,"./util":44}],28:[function(require,module,exports){
"use strict";
module.exports = Message;

var util = require("./util/minimal");

/**
 * Constructs a new message instance.
 * @classdesc Abstract runtime message.
 * @constructor
 * @param {Properties<T>} [properties] Properties to set
 * @template T extends object = object
 */
function Message(properties) {
    // not used internally
    if (properties)
        for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
            this[keys[i]] = properties[keys[i]];
}

/**
 * Reference to the reflected type.
 * @name Message.$type
 * @type {Type}
 * @readonly
 */

/**
 * Reference to the reflected type.
 * @name Message#$type
 * @type {Type}
 * @readonly
 */

/*eslint-disable valid-jsdoc*/

/**
 * Creates a new message of this type using the specified properties.
 * @param {Object.<string,*>} [properties] Properties to set
 * @returns {Message<T>} Message instance
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.create = function create(properties) {
    return this.$type.create(properties);
};

/**
 * Encodes a message of this type.
 * @param {T|Object.<string,*>} message Message to encode
 * @param {Writer} [writer] Writer to use
 * @returns {Writer} Writer
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.encode = function encode(message, writer) {
    return this.$type.encode(message, writer);
};

/**
 * Encodes a message of this type preceeded by its length as a varint.
 * @param {T|Object.<string,*>} message Message to encode
 * @param {Writer} [writer] Writer to use
 * @returns {Writer} Writer
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.encodeDelimited = function encodeDelimited(message, writer) {
    return this.$type.encodeDelimited(message, writer);
};

/**
 * Decodes a message of this type.
 * @name Message.decode
 * @function
 * @param {Reader|Uint8Array} reader Reader or buffer to decode
 * @returns {T} Decoded message
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.decode = function decode(reader) {
    return this.$type.decode(reader);
};

/**
 * Decodes a message of this type preceeded by its length as a varint.
 * @name Message.decodeDelimited
 * @function
 * @param {Reader|Uint8Array} reader Reader or buffer to decode
 * @returns {T} Decoded message
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.decodeDelimited = function decodeDelimited(reader) {
    return this.$type.decodeDelimited(reader);
};

/**
 * Verifies a message of this type.
 * @name Message.verify
 * @function
 * @param {Object.<string,*>} message Plain object to verify
 * @returns {string|null} `null` if valid, otherwise the reason why it is not
 */
Message.verify = function verify(message) {
    return this.$type.verify(message);
};

/**
 * Creates a new message of this type from a plain object. Also converts values to their respective internal types.
 * @param {Object.<string,*>} object Plain object
 * @returns {T} Message instance
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.fromObject = function fromObject(object) {
    return this.$type.fromObject(object);
};

/**
 * Creates a plain object from a message of this type. Also converts values to other types if specified.
 * @param {T} message Message instance
 * @param {IConversionOptions} [options] Conversion options
 * @returns {Object.<string,*>} Plain object
 * @template T extends Message<T>
 * @this Constructor<T>
 */
Message.toObject = function toObject(message, options) {
    return this.$type.toObject(message, options);
};

/**
 * Converts this message to JSON.
 * @returns {Object.<string,*>} JSON object
 */
Message.prototype.toJSON = function toJSON() {
    return this.$type.toObject(this, util.toJSONOptions);
};

/*eslint-enable valid-jsdoc*/
},{"./util/minimal":46}],29:[function(require,module,exports){
"use strict";
module.exports = Method;

// extends ReflectionObject
var ReflectionObject = require("./object");
((Method.prototype = Object.create(ReflectionObject.prototype)).constructor = Method).className = "Method";

var util = require("./util");

/**
 * Constructs a new service method instance.
 * @classdesc Reflected service method.
 * @extends ReflectionObject
 * @constructor
 * @param {string} name Method name
 * @param {string|undefined} type Method type, usually `"rpc"`
 * @param {string} requestType Request message type
 * @param {string} responseType Response message type
 * @param {boolean|Object.<string,*>} [requestStream] Whether the request is streamed
 * @param {boolean|Object.<string,*>} [responseStream] Whether the response is streamed
 * @param {Object.<string,*>} [options] Declared options
 * @param {string} [comment] The comment for this method
 * @param {Object.<string,*>} [parsedOptions] Declared options, properly parsed into an object
 */
function Method(name, type, requestType, responseType, requestStream, responseStream, options, comment, parsedOptions) {

    /* istanbul ignore next */
    if (util.isObject(requestStream)) {
        options = requestStream;
        requestStream = responseStream = undefined;
    } else if (util.isObject(responseStream)) {
        options = responseStream;
        responseStream = undefined;
    }

    /* istanbul ignore if */
    if (!(type === undefined || util.isString(type)))
        throw TypeError("type must be a string");

    /* istanbul ignore if */
    if (!util.isString(requestType))
        throw TypeError("requestType must be a string");

    /* istanbul ignore if */
    if (!util.isString(responseType))
        throw TypeError("responseType must be a string");

    ReflectionObject.call(this, name, options);

    /**
     * Method type.
     * @type {string}
     */
    this.type = type || "rpc"; // toJSON

    /**
     * Request type.
     * @type {string}
     */
    this.requestType = requestType; // toJSON, marker

    /**
     * Whether requests are streamed or not.
     * @type {boolean|undefined}
     */
    this.requestStream = requestStream ? true : undefined; // toJSON

    /**
     * Response type.
     * @type {string}
     */
    this.responseType = responseType; // toJSON

    /**
     * Whether responses are streamed or not.
     * @type {boolean|undefined}
     */
    this.responseStream = responseStream ? true : undefined; // toJSON

    /**
     * Resolved request type.
     * @type {Type|null}
     */
    this.resolvedRequestType = null;

    /**
     * Resolved response type.
     * @type {Type|null}
     */
    this.resolvedResponseType = null;

    /**
     * Comment for this method
     * @type {string|null}
     */
    this.comment = comment;

    /**
     * Options properly parsed into an object
     */
    this.parsedOptions = parsedOptions;
}

/**
 * Method descriptor.
 * @interface IMethod
 * @property {string} [type="rpc"] Method type
 * @property {string} requestType Request type
 * @property {string} responseType Response type
 * @property {boolean} [requestStream=false] Whether requests are streamed
 * @property {boolean} [responseStream=false] Whether responses are streamed
 * @property {Object.<string,*>} [options] Method options
 * @property {string} comment Method comments
 * @property {Object.<string,*>} [parsedOptions] Method options properly parsed into an object
 */

/**
 * Constructs a method from a method descriptor.
 * @param {string} name Method name
 * @param {IMethod} json Method descriptor
 * @returns {Method} Created method
 * @throws {TypeError} If arguments are invalid
 */
Method.fromJSON = function fromJSON(name, json) {
    return new Method(name, json.type, json.requestType, json.responseType, json.requestStream, json.responseStream, json.options, json.comment, json.parsedOptions);
};

/**
 * Converts this method to a method descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IMethod} Method descriptor
 */
Method.prototype.toJSON = function toJSON(toJSONOptions) {
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "type"           , this.type !== "rpc" && /* istanbul ignore next */ this.type || undefined,
        "requestType"    , this.requestType,
        "requestStream"  , this.requestStream,
        "responseType"   , this.responseType,
        "responseStream" , this.responseStream,
        "options"        , this.options,
        "comment"        , keepComments ? this.comment : undefined,
        "parsedOptions"  , this.parsedOptions,
    ]);
};

/**
 * @override
 */
Method.prototype.resolve = function resolve() {

    /* istanbul ignore if */
    if (this.resolved)
        return this;

    this.resolvedRequestType = this.parent.lookupType(this.requestType);
    this.resolvedResponseType = this.parent.lookupType(this.responseType);

    return ReflectionObject.prototype.resolve.call(this);
};

},{"./object":31,"./util":44}],30:[function(require,module,exports){
"use strict";
module.exports = Namespace;

// extends ReflectionObject
var ReflectionObject = require("./object");
((Namespace.prototype = Object.create(ReflectionObject.prototype)).constructor = Namespace).className = "Namespace";

var Field    = require("./field"),
    util     = require("./util"),
    OneOf    = require("./oneof");

var Type,    // cyclic
    Service,
    Enum;

/**
 * Constructs a new namespace instance.
 * @name Namespace
 * @classdesc Reflected namespace.
 * @extends NamespaceBase
 * @constructor
 * @param {string} name Namespace name
 * @param {Object.<string,*>} [options] Declared options
 */

/**
 * Constructs a namespace from JSON.
 * @memberof Namespace
 * @function
 * @param {string} name Namespace name
 * @param {Object.<string,*>} json JSON object
 * @returns {Namespace} Created namespace
 * @throws {TypeError} If arguments are invalid
 */
Namespace.fromJSON = function fromJSON(name, json) {
    return new Namespace(name, json.options).addJSON(json.nested);
};

/**
 * Converts an array of reflection objects to JSON.
 * @memberof Namespace
 * @param {ReflectionObject[]} array Object array
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {Object.<string,*>|undefined} JSON object or `undefined` when array is empty
 */
function arrayToJSON(array, toJSONOptions) {
    if (!(array && array.length))
        return undefined;
    var obj = {};
    for (var i = 0; i < array.length; ++i)
        obj[array[i].name] = array[i].toJSON(toJSONOptions);
    return obj;
}

Namespace.arrayToJSON = arrayToJSON;

/**
 * Tests if the specified id is reserved.
 * @param {Array.<number[]|string>|undefined} reserved Array of reserved ranges and names
 * @param {number} id Id to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
Namespace.isReservedId = function isReservedId(reserved, id) {
    if (reserved)
        for (var i = 0; i < reserved.length; ++i)
            if (typeof reserved[i] !== "string" && reserved[i][0] <= id && reserved[i][1] > id)
                return true;
    return false;
};

/**
 * Tests if the specified name is reserved.
 * @param {Array.<number[]|string>|undefined} reserved Array of reserved ranges and names
 * @param {string} name Name to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
Namespace.isReservedName = function isReservedName(reserved, name) {
    if (reserved)
        for (var i = 0; i < reserved.length; ++i)
            if (reserved[i] === name)
                return true;
    return false;
};

/**
 * Not an actual constructor. Use {@link Namespace} instead.
 * @classdesc Base class of all reflection objects containing nested objects. This is not an actual class but here for the sake of having consistent type definitions.
 * @exports NamespaceBase
 * @extends ReflectionObject
 * @abstract
 * @constructor
 * @param {string} name Namespace name
 * @param {Object.<string,*>} [options] Declared options
 * @see {@link Namespace}
 */
function Namespace(name, options) {
    ReflectionObject.call(this, name, options);

    /**
     * Nested objects by name.
     * @type {Object.<string,ReflectionObject>|undefined}
     */
    this.nested = undefined; // toJSON

    /**
     * Cached nested objects as an array.
     * @type {ReflectionObject[]|null}
     * @private
     */
    this._nestedArray = null;
}

function clearCache(namespace) {
    namespace._nestedArray = null;
    return namespace;
}

/**
 * Nested objects of this namespace as an array for iteration.
 * @name NamespaceBase#nestedArray
 * @type {ReflectionObject[]}
 * @readonly
 */
Object.defineProperty(Namespace.prototype, "nestedArray", {
    get: function() {
        return this._nestedArray || (this._nestedArray = util.toArray(this.nested));
    }
});

/**
 * Namespace descriptor.
 * @interface INamespace
 * @property {Object.<string,*>} [options] Namespace options
 * @property {Object.<string,AnyNestedObject>} [nested] Nested object descriptors
 */

/**
 * Any extension field descriptor.
 * @typedef AnyExtensionField
 * @type {IExtensionField|IExtensionMapField}
 */

/**
 * Any nested object descriptor.
 * @typedef AnyNestedObject
 * @type {IEnum|IType|IService|AnyExtensionField|INamespace|IOneOf}
 */

/**
 * Converts this namespace to a namespace descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {INamespace} Namespace descriptor
 */
Namespace.prototype.toJSON = function toJSON(toJSONOptions) {
    return util.toObject([
        "options" , this.options,
        "nested"  , arrayToJSON(this.nestedArray, toJSONOptions)
    ]);
};

/**
 * Adds nested objects to this namespace from nested object descriptors.
 * @param {Object.<string,AnyNestedObject>} nestedJson Any nested object descriptors
 * @returns {Namespace} `this`
 */
Namespace.prototype.addJSON = function addJSON(nestedJson) {
    var ns = this;
    /* istanbul ignore else */
    if (nestedJson) {
        for (var names = Object.keys(nestedJson), i = 0, nested; i < names.length; ++i) {
            nested = nestedJson[names[i]];
            ns.add( // most to least likely
                ( nested.fields !== undefined
                ? Type.fromJSON
                : nested.values !== undefined
                ? Enum.fromJSON
                : nested.methods !== undefined
                ? Service.fromJSON
                : nested.id !== undefined
                ? Field.fromJSON
                : Namespace.fromJSON )(names[i], nested)
            );
        }
    }
    return this;
};

/**
 * Gets the nested object of the specified name.
 * @param {string} name Nested object name
 * @returns {ReflectionObject|null} The reflection object or `null` if it doesn't exist
 */
Namespace.prototype.get = function get(name) {
    return this.nested && this.nested[name]
        || null;
};

/**
 * Gets the values of the nested {@link Enum|enum} of the specified name.
 * This methods differs from {@link Namespace#get|get} in that it returns an enum's values directly and throws instead of returning `null`.
 * @param {string} name Nested enum name
 * @returns {Object.<string,number>} Enum values
 * @throws {Error} If there is no such enum
 */
Namespace.prototype.getEnum = function getEnum(name) {
    if (this.nested && this.nested[name] instanceof Enum)
        return this.nested[name].values;
    throw Error("no such enum: " + name);
};

/**
 * Adds a nested object to this namespace.
 * @param {ReflectionObject} object Nested object to add
 * @returns {Namespace} `this`
 * @throws {TypeError} If arguments are invalid
 * @throws {Error} If there is already a nested object with this name
 */
Namespace.prototype.add = function add(object) {

    if (!(object instanceof Field && object.extend !== undefined || object instanceof Type  || object instanceof OneOf || object instanceof Enum || object instanceof Service || object instanceof Namespace))
        throw TypeError("object must be a valid nested object");

    if (!this.nested)
        this.nested = {};
    else {
        var prev = this.get(object.name);
        if (prev) {
            if (prev instanceof Namespace && object instanceof Namespace && !(prev instanceof Type || prev instanceof Service)) {
                // replace plain namespace but keep existing nested elements and options
                var nested = prev.nestedArray;
                for (var i = 0; i < nested.length; ++i)
                    object.add(nested[i]);
                this.remove(prev);
                if (!this.nested)
                    this.nested = {};
                object.setOptions(prev.options, true);

            } else
                throw Error("duplicate name '" + object.name + "' in " + this);
        }
    }
    this.nested[object.name] = object;
    object.onAdd(this);
    return clearCache(this);
};

/**
 * Removes a nested object from this namespace.
 * @param {ReflectionObject} object Nested object to remove
 * @returns {Namespace} `this`
 * @throws {TypeError} If arguments are invalid
 * @throws {Error} If `object` is not a member of this namespace
 */
Namespace.prototype.remove = function remove(object) {

    if (!(object instanceof ReflectionObject))
        throw TypeError("object must be a ReflectionObject");
    if (object.parent !== this)
        throw Error(object + " is not a member of " + this);

    delete this.nested[object.name];
    if (!Object.keys(this.nested).length)
        this.nested = undefined;

    object.onRemove(this);
    return clearCache(this);
};

/**
 * Defines additial namespaces within this one if not yet existing.
 * @param {string|string[]} path Path to create
 * @param {*} [json] Nested types to create from JSON
 * @returns {Namespace} Pointer to the last namespace created or `this` if path is empty
 */
Namespace.prototype.define = function define(path, json) {

    if (util.isString(path))
        path = path.split(".");
    else if (!Array.isArray(path))
        throw TypeError("illegal path");
    if (path && path.length && path[0] === "")
        throw Error("path must be relative");

    var ptr = this;
    while (path.length > 0) {
        var part = path.shift();
        if (ptr.nested && ptr.nested[part]) {
            ptr = ptr.nested[part];
            if (!(ptr instanceof Namespace))
                throw Error("path conflicts with non-namespace objects");
        } else
            ptr.add(ptr = new Namespace(part));
    }
    if (json)
        ptr.addJSON(json);
    return ptr;
};

/**
 * Resolves this namespace's and all its nested objects' type references. Useful to validate a reflection tree, but comes at a cost.
 * @returns {Namespace} `this`
 */
Namespace.prototype.resolveAll = function resolveAll() {
    var nested = this.nestedArray, i = 0;
    while (i < nested.length)
        if (nested[i] instanceof Namespace)
            nested[i++].resolveAll();
        else
            nested[i++].resolve();
    return this.resolve();
};

/**
 * Recursively looks up the reflection object matching the specified path in the scope of this namespace.
 * @param {string|string[]} path Path to look up
 * @param {*|Array.<*>} filterTypes Filter types, any combination of the constructors of `protobuf.Type`, `protobuf.Enum`, `protobuf.Service` etc.
 * @param {boolean} [parentAlreadyChecked=false] If known, whether the parent has already been checked
 * @returns {ReflectionObject|null} Looked up object or `null` if none could be found
 */
Namespace.prototype.lookup = function lookup(path, filterTypes, parentAlreadyChecked) {

    /* istanbul ignore next */
    if (typeof filterTypes === "boolean") {
        parentAlreadyChecked = filterTypes;
        filterTypes = undefined;
    } else if (filterTypes && !Array.isArray(filterTypes))
        filterTypes = [ filterTypes ];

    if (util.isString(path) && path.length) {
        if (path === ".")
            return this.root;
        path = path.split(".");
    } else if (!path.length)
        return this;

    // Start at root if path is absolute
    if (path[0] === "")
        return this.root.lookup(path.slice(1), filterTypes);

    // Test if the first part matches any nested object, and if so, traverse if path contains more
    var found = this.get(path[0]);
    if (found) {
        if (path.length === 1) {
            if (!filterTypes || filterTypes.indexOf(found.constructor) > -1)
                return found;
        } else if (found instanceof Namespace && (found = found.lookup(path.slice(1), filterTypes, true)))
            return found;

    // Otherwise try each nested namespace
    } else
        for (var i = 0; i < this.nestedArray.length; ++i)
            if (this._nestedArray[i] instanceof Namespace && (found = this._nestedArray[i].lookup(path, filterTypes, true)))
                return found;

    // If there hasn't been a match, try again at the parent
    if (this.parent === null || parentAlreadyChecked)
        return null;
    return this.parent.lookup(path, filterTypes);
};

/**
 * Looks up the reflection object at the specified path, relative to this namespace.
 * @name NamespaceBase#lookup
 * @function
 * @param {string|string[]} path Path to look up
 * @param {boolean} [parentAlreadyChecked=false] Whether the parent has already been checked
 * @returns {ReflectionObject|null} Looked up object or `null` if none could be found
 * @variation 2
 */
// lookup(path: string, [parentAlreadyChecked: boolean])

/**
 * Looks up the {@link Type|type} at the specified path, relative to this namespace.
 * Besides its signature, this methods differs from {@link Namespace#lookup|lookup} in that it throws instead of returning `null`.
 * @param {string|string[]} path Path to look up
 * @returns {Type} Looked up type
 * @throws {Error} If `path` does not point to a type
 */
Namespace.prototype.lookupType = function lookupType(path) {
    var found = this.lookup(path, [ Type ]);
    if (!found)
        throw Error("no such type: " + path);
    return found;
};

/**
 * Looks up the values of the {@link Enum|enum} at the specified path, relative to this namespace.
 * Besides its signature, this methods differs from {@link Namespace#lookup|lookup} in that it throws instead of returning `null`.
 * @param {string|string[]} path Path to look up
 * @returns {Enum} Looked up enum
 * @throws {Error} If `path` does not point to an enum
 */
Namespace.prototype.lookupEnum = function lookupEnum(path) {
    var found = this.lookup(path, [ Enum ]);
    if (!found)
        throw Error("no such Enum '" + path + "' in " + this);
    return found;
};

/**
 * Looks up the {@link Type|type} or {@link Enum|enum} at the specified path, relative to this namespace.
 * Besides its signature, this methods differs from {@link Namespace#lookup|lookup} in that it throws instead of returning `null`.
 * @param {string|string[]} path Path to look up
 * @returns {Type} Looked up type or enum
 * @throws {Error} If `path` does not point to a type or enum
 */
Namespace.prototype.lookupTypeOrEnum = function lookupTypeOrEnum(path) {
    var found = this.lookup(path, [ Type, Enum ]);
    if (!found)
        throw Error("no such Type or Enum '" + path + "' in " + this);
    return found;
};

/**
 * Looks up the {@link Service|service} at the specified path, relative to this namespace.
 * Besides its signature, this methods differs from {@link Namespace#lookup|lookup} in that it throws instead of returning `null`.
 * @param {string|string[]} path Path to look up
 * @returns {Service} Looked up service
 * @throws {Error} If `path` does not point to a service
 */
Namespace.prototype.lookupService = function lookupService(path) {
    var found = this.lookup(path, [ Service ]);
    if (!found)
        throw Error("no such Service '" + path + "' in " + this);
    return found;
};

// Sets up cyclic dependencies (called in index-light)
Namespace._configure = function(Type_, Service_, Enum_) {
    Type    = Type_;
    Service = Service_;
    Enum    = Enum_;
};

},{"./field":23,"./object":31,"./oneof":32,"./util":44}],31:[function(require,module,exports){
"use strict";
module.exports = ReflectionObject;

ReflectionObject.className = "ReflectionObject";

var util = require("./util");

var Root; // cyclic

/**
 * Constructs a new reflection object instance.
 * @classdesc Base class of all reflection objects.
 * @constructor
 * @param {string} name Object name
 * @param {Object.<string,*>} [options] Declared options
 * @abstract
 */
function ReflectionObject(name, options) {

    if (!util.isString(name))
        throw TypeError("name must be a string");

    if (options && !util.isObject(options))
        throw TypeError("options must be an object");

    /**
     * Options.
     * @type {Object.<string,*>|undefined}
     */
    this.options = options; // toJSON

    /**
     * Parsed Options.
     * @type {Array.<Object.<string,*>>|undefined}
     */
    this.parsedOptions = null;

    /**
     * Unique name within its namespace.
     * @type {string}
     */
    this.name = name;

    /**
     * Parent namespace.
     * @type {Namespace|null}
     */
    this.parent = null;

    /**
     * Whether already resolved or not.
     * @type {boolean}
     */
    this.resolved = false;

    /**
     * Comment text, if any.
     * @type {string|null}
     */
    this.comment = null;

    /**
     * Defining file name.
     * @type {string|null}
     */
    this.filename = null;
}

Object.defineProperties(ReflectionObject.prototype, {

    /**
     * Reference to the root namespace.
     * @name ReflectionObject#root
     * @type {Root}
     * @readonly
     */
    root: {
        get: function() {
            var ptr = this;
            while (ptr.parent !== null)
                ptr = ptr.parent;
            return ptr;
        }
    },

    /**
     * Full name including leading dot.
     * @name ReflectionObject#fullName
     * @type {string}
     * @readonly
     */
    fullName: {
        get: function() {
            var path = [ this.name ],
                ptr = this.parent;
            while (ptr) {
                path.unshift(ptr.name);
                ptr = ptr.parent;
            }
            return path.join(".");
        }
    }
});

/**
 * Converts this reflection object to its descriptor representation.
 * @returns {Object.<string,*>} Descriptor
 * @abstract
 */
ReflectionObject.prototype.toJSON = /* istanbul ignore next */ function toJSON() {
    throw Error(); // not implemented, shouldn't happen
};

/**
 * Called when this object is added to a parent.
 * @param {ReflectionObject} parent Parent added to
 * @returns {undefined}
 */
ReflectionObject.prototype.onAdd = function onAdd(parent) {
    if (this.parent && this.parent !== parent)
        this.parent.remove(this);
    this.parent = parent;
    this.resolved = false;
    var root = parent.root;
    if (root instanceof Root)
        root._handleAdd(this);
};

/**
 * Called when this object is removed from a parent.
 * @param {ReflectionObject} parent Parent removed from
 * @returns {undefined}
 */
ReflectionObject.prototype.onRemove = function onRemove(parent) {
    var root = parent.root;
    if (root instanceof Root)
        root._handleRemove(this);
    this.parent = null;
    this.resolved = false;
};

/**
 * Resolves this objects type references.
 * @returns {ReflectionObject} `this`
 */
ReflectionObject.prototype.resolve = function resolve() {
    if (this.resolved)
        return this;
    if (this.root instanceof Root)
        this.resolved = true; // only if part of a root
    return this;
};

/**
 * Gets an option value.
 * @param {string} name Option name
 * @returns {*} Option value or `undefined` if not set
 */
ReflectionObject.prototype.getOption = function getOption(name) {
    if (this.options)
        return this.options[name];
    return undefined;
};

/**
 * Sets an option.
 * @param {string} name Option name
 * @param {*} value Option value
 * @param {boolean} [ifNotSet] Sets the option only if it isn't currently set
 * @returns {ReflectionObject} `this`
 */
ReflectionObject.prototype.setOption = function setOption(name, value, ifNotSet) {
    if (!ifNotSet || !this.options || this.options[name] === undefined)
        (this.options || (this.options = {}))[name] = value;
    return this;
};

/**
 * Sets a parsed option.
 * @param {string} name parsed Option name
 * @param {*} value Option value
 * @param {string} propName dot '.' delimited full path of property within the option to set. if undefined\empty, will add a new option with that value
 * @returns {ReflectionObject} `this`
 */
ReflectionObject.prototype.setParsedOption = function setParsedOption(name, value, propName) {
    if (!this.parsedOptions) {
        this.parsedOptions = [];
    }
    var parsedOptions = this.parsedOptions;
    if (propName) {
        // If setting a sub property of an option then try to merge it
        // with an existing option
        var opt = parsedOptions.find(function (opt) {
            return Object.prototype.hasOwnProperty.call(opt, name);
        });
        if (opt) {
            // If we found an existing option - just merge the property value
            var newValue = opt[name];
            util.setProperty(newValue, propName, value);
        } else {
            // otherwise, create a new option, set it's property and add it to the list
            opt = {};
            opt[name] = util.setProperty({}, propName, value);
            parsedOptions.push(opt);
        }
    } else {
        // Always create a new option when setting the value of the option itself
        var newOpt = {};
        newOpt[name] = value;
        parsedOptions.push(newOpt);
    }
    return this;
};

/**
 * Sets multiple options.
 * @param {Object.<string,*>} options Options to set
 * @param {boolean} [ifNotSet] Sets an option only if it isn't currently set
 * @returns {ReflectionObject} `this`
 */
ReflectionObject.prototype.setOptions = function setOptions(options, ifNotSet) {
    if (options)
        for (var keys = Object.keys(options), i = 0; i < keys.length; ++i)
            this.setOption(keys[i], options[keys[i]], ifNotSet);
    return this;
};

/**
 * Converts this instance to its string representation.
 * @returns {string} Class name[, space, full name]
 */
ReflectionObject.prototype.toString = function toString() {
    var className = this.constructor.className,
        fullName  = this.fullName;
    if (fullName.length)
        return className + " " + fullName;
    return className;
};

// Sets up cyclic dependencies (called in index-light)
ReflectionObject._configure = function(Root_) {
    Root = Root_;
};

},{"./util":44}],32:[function(require,module,exports){
"use strict";
module.exports = OneOf;

// extends ReflectionObject
var ReflectionObject = require("./object");
((OneOf.prototype = Object.create(ReflectionObject.prototype)).constructor = OneOf).className = "OneOf";

var Field = require("./field"),
    util  = require("./util");

/**
 * Constructs a new oneof instance.
 * @classdesc Reflected oneof.
 * @extends ReflectionObject
 * @constructor
 * @param {string} name Oneof name
 * @param {string[]|Object.<string,*>} [fieldNames] Field names
 * @param {Object.<string,*>} [options] Declared options
 * @param {string} [comment] Comment associated with this field
 */
function OneOf(name, fieldNames, options, comment) {
    if (!Array.isArray(fieldNames)) {
        options = fieldNames;
        fieldNames = undefined;
    }
    ReflectionObject.call(this, name, options);

    /* istanbul ignore if */
    if (!(fieldNames === undefined || Array.isArray(fieldNames)))
        throw TypeError("fieldNames must be an Array");

    /**
     * Field names that belong to this oneof.
     * @type {string[]}
     */
    this.oneof = fieldNames || []; // toJSON, marker

    /**
     * Fields that belong to this oneof as an array for iteration.
     * @type {Field[]}
     * @readonly
     */
    this.fieldsArray = []; // declared readonly for conformance, possibly not yet added to parent

    /**
     * Comment for this field.
     * @type {string|null}
     */
    this.comment = comment;
}

/**
 * Oneof descriptor.
 * @interface IOneOf
 * @property {Array.<string>} oneof Oneof field names
 * @property {Object.<string,*>} [options] Oneof options
 */

/**
 * Constructs a oneof from a oneof descriptor.
 * @param {string} name Oneof name
 * @param {IOneOf} json Oneof descriptor
 * @returns {OneOf} Created oneof
 * @throws {TypeError} If arguments are invalid
 */
OneOf.fromJSON = function fromJSON(name, json) {
    return new OneOf(name, json.oneof, json.options, json.comment);
};

/**
 * Converts this oneof to a oneof descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IOneOf} Oneof descriptor
 */
OneOf.prototype.toJSON = function toJSON(toJSONOptions) {
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "options" , this.options,
        "oneof"   , this.oneof,
        "comment" , keepComments ? this.comment : undefined
    ]);
};

/**
 * Adds the fields of the specified oneof to the parent if not already done so.
 * @param {OneOf} oneof The oneof
 * @returns {undefined}
 * @inner
 * @ignore
 */
function addFieldsToParent(oneof) {
    if (oneof.parent)
        for (var i = 0; i < oneof.fieldsArray.length; ++i)
            if (!oneof.fieldsArray[i].parent)
                oneof.parent.add(oneof.fieldsArray[i]);
}

/**
 * Adds a field to this oneof and removes it from its current parent, if any.
 * @param {Field} field Field to add
 * @returns {OneOf} `this`
 */
OneOf.prototype.add = function add(field) {

    /* istanbul ignore if */
    if (!(field instanceof Field))
        throw TypeError("field must be a Field");

    if (field.parent && field.parent !== this.parent)
        field.parent.remove(field);
    this.oneof.push(field.name);
    this.fieldsArray.push(field);
    field.partOf = this; // field.parent remains null
    addFieldsToParent(this);
    return this;
};

/**
 * Removes a field from this oneof and puts it back to the oneof's parent.
 * @param {Field} field Field to remove
 * @returns {OneOf} `this`
 */
OneOf.prototype.remove = function remove(field) {

    /* istanbul ignore if */
    if (!(field instanceof Field))
        throw TypeError("field must be a Field");

    var index = this.fieldsArray.indexOf(field);

    /* istanbul ignore if */
    if (index < 0)
        throw Error(field + " is not a member of " + this);

    this.fieldsArray.splice(index, 1);
    index = this.oneof.indexOf(field.name);

    /* istanbul ignore else */
    if (index > -1) // theoretical
        this.oneof.splice(index, 1);

    field.partOf = null;
    return this;
};

/**
 * @override
 */
OneOf.prototype.onAdd = function onAdd(parent) {
    ReflectionObject.prototype.onAdd.call(this, parent);
    var self = this;
    // Collect present fields
    for (var i = 0; i < this.oneof.length; ++i) {
        var field = parent.get(this.oneof[i]);
        if (field && !field.partOf) {
            field.partOf = self;
            self.fieldsArray.push(field);
        }
    }
    // Add not yet present fields
    addFieldsToParent(this);
};

/**
 * @override
 */
OneOf.prototype.onRemove = function onRemove(parent) {
    for (var i = 0, field; i < this.fieldsArray.length; ++i)
        if ((field = this.fieldsArray[i]).parent)
            field.parent.remove(field);
    ReflectionObject.prototype.onRemove.call(this, parent);
};

/**
 * Decorator function as returned by {@link OneOf.d} (TypeScript).
 * @typedef OneOfDecorator
 * @type {function}
 * @param {Object} prototype Target prototype
 * @param {string} oneofName OneOf name
 * @returns {undefined}
 */

/**
 * OneOf decorator (TypeScript).
 * @function
 * @param {...string} fieldNames Field names
 * @returns {OneOfDecorator} Decorator function
 * @template T extends string
 */
OneOf.d = function decorateOneOf() {
    var fieldNames = new Array(arguments.length),
        index = 0;
    while (index < arguments.length)
        fieldNames[index] = arguments[index++];
    return function oneOfDecorator(prototype, oneofName) {
        util.decorateType(prototype.constructor)
            .add(new OneOf(oneofName, fieldNames));
        Object.defineProperty(prototype, oneofName, {
            get: util.oneOfGetter(fieldNames),
            set: util.oneOfSetter(fieldNames)
        });
    };
};

},{"./field":23,"./object":31,"./util":44}],33:[function(require,module,exports){
"use strict";
module.exports = parse;

parse.filename = null;
parse.defaults = { keepCase: false };

var tokenize  = require("./tokenize"),
    Root      = require("./root"),
    Type      = require("./type"),
    Field     = require("./field"),
    MapField  = require("./mapfield"),
    OneOf     = require("./oneof"),
    Enum      = require("./enum"),
    Service   = require("./service"),
    Method    = require("./method"),
    types     = require("./types"),
    util      = require("./util");

var base10Re    = /^[1-9][0-9]*$/,
    base10NegRe = /^-?[1-9][0-9]*$/,
    base16Re    = /^0[x][0-9a-fA-F]+$/,
    base16NegRe = /^-?0[x][0-9a-fA-F]+$/,
    base8Re     = /^0[0-7]+$/,
    base8NegRe  = /^-?0[0-7]+$/,
    numberRe    = /^(?![eE])[0-9]*(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?$/,
    nameRe      = /^[a-zA-Z_][a-zA-Z_0-9]*$/,
    typeRefRe   = /^(?:\.?[a-zA-Z_][a-zA-Z_0-9]*)(?:\.[a-zA-Z_][a-zA-Z_0-9]*)*$/,
    fqTypeRefRe = /^(?:\.[a-zA-Z_][a-zA-Z_0-9]*)+$/;

/**
 * Result object returned from {@link parse}.
 * @interface IParserResult
 * @property {string|undefined} package Package name, if declared
 * @property {string[]|undefined} imports Imports, if any
 * @property {string[]|undefined} weakImports Weak imports, if any
 * @property {string|undefined} syntax Syntax, if specified (either `"proto2"` or `"proto3"`)
 * @property {Root} root Populated root instance
 */

/**
 * Options modifying the behavior of {@link parse}.
 * @interface IParseOptions
 * @property {boolean} [keepCase=false] Keeps field casing instead of converting to camel case
 * @property {boolean} [alternateCommentMode=false] Recognize double-slash comments in addition to doc-block comments.
 * @property {boolean} [preferTrailingComment=false] Use trailing comment when both leading comment and trailing comment exist.
 */

/**
 * Options modifying the behavior of JSON serialization.
 * @interface IToJSONOptions
 * @property {boolean} [keepComments=false] Serializes comments.
 */

/**
 * Parses the given .proto source and returns an object with the parsed contents.
 * @param {string} source Source contents
 * @param {Root} root Root to populate
 * @param {IParseOptions} [options] Parse options. Defaults to {@link parse.defaults} when omitted.
 * @returns {IParserResult} Parser result
 * @property {string} filename=null Currently processing file name for error reporting, if known
 * @property {IParseOptions} defaults Default {@link IParseOptions}
 */
function parse(source, root, options) {
    /* eslint-disable callback-return */
    if (!(root instanceof Root)) {
        options = root;
        root = new Root();
    }
    if (!options)
        options = parse.defaults;

    var preferTrailingComment = options.preferTrailingComment || false;
    var tn = tokenize(source, options.alternateCommentMode || false),
        next = tn.next,
        push = tn.push,
        peek = tn.peek,
        skip = tn.skip,
        cmnt = tn.cmnt;

    var head = true,
        pkg,
        imports,
        weakImports,
        syntax,
        isProto3 = false;

    var ptr = root;

    var applyCase = options.keepCase ? function(name) { return name; } : util.camelCase;

    /* istanbul ignore next */
    function illegal(token, name, insideTryCatch) {
        var filename = parse.filename;
        if (!insideTryCatch)
            parse.filename = null;
        return Error("illegal " + (name || "token") + " '" + token + "' (" + (filename ? filename + ", " : "") + "line " + tn.line + ")");
    }

    function readString() {
        var values = [],
            token;
        do {
            /* istanbul ignore if */
            if ((token = next()) !== "\"" && token !== "'")
                throw illegal(token);

            values.push(next());
            skip(token);
            token = peek();
        } while (token === "\"" || token === "'");
        return values.join("");
    }

    function readValue(acceptTypeRef) {
        var token = next();
        switch (token) {
            case "'":
            case "\"":
                push(token);
                return readString();
            case "true": case "TRUE":
                return true;
            case "false": case "FALSE":
                return false;
        }
        try {
            return parseNumber(token, /* insideTryCatch */ true);
        } catch (e) {

            /* istanbul ignore else */
            if (acceptTypeRef && typeRefRe.test(token))
                return token;

            /* istanbul ignore next */
            throw illegal(token, "value");
        }
    }

    function readRanges(target, acceptStrings) {
        var token, start;
        do {
            if (acceptStrings && ((token = peek()) === "\"" || token === "'"))
                target.push(readString());
            else
                target.push([ start = parseId(next()), skip("to", true) ? parseId(next()) : start ]);
        } while (skip(",", true));
        var dummy = {options: undefined};
        dummy.setOption = function(name, value) {
          if (this.options === undefined) this.options = {};
          this.options[name] = value;
        };
        ifBlock(
            dummy,
            function parseRange_block(token) {
              /* istanbul ignore else */
              if (token === "option") {
                parseOption(dummy, token);  // skip
                skip(";");
              } else
                throw illegal(token);
            },
            function parseRange_line() {
              parseInlineOptions(dummy);  // skip
            });
    }

    function parseNumber(token, insideTryCatch) {
        var sign = 1;
        if (token.charAt(0) === "-") {
            sign = -1;
            token = token.substring(1);
        }
        switch (token) {
            case "inf": case "INF": case "Inf":
                return sign * Infinity;
            case "nan": case "NAN": case "Nan": case "NaN":
                return NaN;
            case "0":
                return 0;
        }
        if (base10Re.test(token))
            return sign * parseInt(token, 10);
        if (base16Re.test(token))
            return sign * parseInt(token, 16);
        if (base8Re.test(token))
            return sign * parseInt(token, 8);

        /* istanbul ignore else */
        if (numberRe.test(token))
            return sign * parseFloat(token);

        /* istanbul ignore next */
        throw illegal(token, "number", insideTryCatch);
    }

    function parseId(token, acceptNegative) {
        switch (token) {
            case "max": case "MAX": case "Max":
                return 536870911;
            case "0":
                return 0;
        }

        /* istanbul ignore if */
        if (!acceptNegative && token.charAt(0) === "-")
            throw illegal(token, "id");

        if (base10NegRe.test(token))
            return parseInt(token, 10);
        if (base16NegRe.test(token))
            return parseInt(token, 16);

        /* istanbul ignore else */
        if (base8NegRe.test(token))
            return parseInt(token, 8);

        /* istanbul ignore next */
        throw illegal(token, "id");
    }

    function parsePackage() {

        /* istanbul ignore if */
        if (pkg !== undefined)
            throw illegal("package");

        pkg = next();

        /* istanbul ignore if */
        if (!typeRefRe.test(pkg))
            throw illegal(pkg, "name");

        ptr = ptr.define(pkg);
        skip(";");
    }

    function parseImport() {
        var token = peek();
        var whichImports;
        switch (token) {
            case "weak":
                whichImports = weakImports || (weakImports = []);
                next();
                break;
            case "public":
                next();
                // eslint-disable-next-line no-fallthrough
            default:
                whichImports = imports || (imports = []);
                break;
        }
        token = readString();
        skip(";");
        whichImports.push(token);
    }

    function parseSyntax() {
        skip("=");
        syntax = readString();
        isProto3 = syntax === "proto3";

        /* istanbul ignore if */
        if (!isProto3 && syntax !== "proto2")
            throw illegal(syntax, "syntax");

        // Syntax is needed to understand the meaning of the optional field rule
        // Otherwise the meaning is ambiguous between proto2 and proto3
        root.setOption("syntax", syntax);

        skip(";");
    }

    function parseCommon(parent, token) {
        switch (token) {

            case "option":
                parseOption(parent, token);
                skip(";");
                return true;

            case "message":
                parseType(parent, token);
                return true;

            case "enum":
                parseEnum(parent, token);
                return true;

            case "service":
                parseService(parent, token);
                return true;

            case "extend":
                parseExtension(parent, token);
                return true;
        }
        return false;
    }

    function ifBlock(obj, fnIf, fnElse) {
        var trailingLine = tn.line;
        if (obj) {
            if(typeof obj.comment !== "string") {
              obj.comment = cmnt(); // try block-type comment
            }
            obj.filename = parse.filename;
        }
        if (skip("{", true)) {
            var token;
            while ((token = next()) !== "}")
                fnIf(token);
            skip(";", true);
        } else {
            if (fnElse)
                fnElse();
            skip(";");
            if (obj && (typeof obj.comment !== "string" || preferTrailingComment))
                obj.comment = cmnt(trailingLine) || obj.comment; // try line-type comment
        }
    }

    function parseType(parent, token) {

        /* istanbul ignore if */
        if (!nameRe.test(token = next()))
            throw illegal(token, "type name");

        var type = new Type(token);
        ifBlock(type, function parseType_block(token) {
            if (parseCommon(type, token))
                return;

            switch (token) {

                case "map":
                    parseMapField(type, token);
                    break;

                case "required":
                case "repeated":
                    parseField(type, token);
                    break;

                case "optional":
                    /* istanbul ignore if */
                    if (isProto3) {
                        parseField(type, "proto3_optional");
                    } else {
                        parseField(type, "optional");
                    }
                    break;

                case "oneof":
                    parseOneOf(type, token);
                    break;

                case "extensions":
                    readRanges(type.extensions || (type.extensions = []));
                    break;

                case "reserved":
                    readRanges(type.reserved || (type.reserved = []), true);
                    break;

                default:
                    /* istanbul ignore if */
                    if (!isProto3 || !typeRefRe.test(token))
                        throw illegal(token);

                    push(token);
                    parseField(type, "optional");
                    break;
            }
        });
        parent.add(type);
    }

    function parseField(parent, rule, extend) {
        var type = next();
        if (type === "group") {
            parseGroup(parent, rule);
            return;
        }
        // Type names can consume multiple tokens, in multiple variants:
        //    package.subpackage   field       tokens: "package.subpackage" [TYPE NAME ENDS HERE] "field"
        //    package . subpackage field       tokens: "package" "." "subpackage" [TYPE NAME ENDS HERE] "field"
        //    package.  subpackage field       tokens: "package." "subpackage" [TYPE NAME ENDS HERE] "field"
        //    package  .subpackage field       tokens: "package" ".subpackage" [TYPE NAME ENDS HERE] "field"
        // Keep reading tokens until we get a type name with no period at the end,
        // and the next token does not start with a period.
        while (type.endsWith(".") || peek().startsWith(".")) {
            type += next();
        }

        /* istanbul ignore if */
        if (!typeRefRe.test(type))
            throw illegal(type, "type");

        var name = next();

        /* istanbul ignore if */
        if (!nameRe.test(name))
            throw illegal(name, "name");

        name = applyCase(name);
        skip("=");

        var field = new Field(name, parseId(next()), type, rule, extend);
        ifBlock(field, function parseField_block(token) {

            /* istanbul ignore else */
            if (token === "option") {
                parseOption(field, token);
                skip(";");
            } else
                throw illegal(token);

        }, function parseField_line() {
            parseInlineOptions(field);
        });

        if (rule === "proto3_optional") {
            // for proto3 optional fields, we create a single-member Oneof to mimic "optional" behavior
            var oneof = new OneOf("_" + name);
            field.setOption("proto3_optional", true);
            oneof.add(field);
            parent.add(oneof);
        } else {
            parent.add(field);
        }

        // JSON defaults to packed=true if not set so we have to set packed=false explicity when
        // parsing proto2 descriptors without the option, where applicable. This must be done for
        // all known packable types and anything that could be an enum (= is not a basic type).
        if (!isProto3 && field.repeated && (types.packed[type] !== undefined || types.basic[type] === undefined))
            field.setOption("packed", false, /* ifNotSet */ true);
    }

    function parseGroup(parent, rule) {
        var name = next();

        /* istanbul ignore if */
        if (!nameRe.test(name))
            throw illegal(name, "name");

        var fieldName = util.lcFirst(name);
        if (name === fieldName)
            name = util.ucFirst(name);
        skip("=");
        var id = parseId(next());
        var type = new Type(name);
        type.group = true;
        var field = new Field(fieldName, id, name, rule);
        field.filename = parse.filename;
        ifBlock(type, function parseGroup_block(token) {
            switch (token) {

                case "option":
                    parseOption(type, token);
                    skip(";");
                    break;

                case "required":
                case "repeated":
                    parseField(type, token);
                    break;

                case "optional":
                    /* istanbul ignore if */
                    if (isProto3) {
                        parseField(type, "proto3_optional");
                    } else {
                        parseField(type, "optional");
                    }
                    break;

                case "message":
                    parseType(type, token);
                    break;

                case "enum":
                    parseEnum(type, token);
                    break;

                /* istanbul ignore next */
                default:
                    throw illegal(token); // there are no groups with proto3 semantics
            }
        });
        parent.add(type)
              .add(field);
    }

    function parseMapField(parent) {
        skip("<");
        var keyType = next();

        /* istanbul ignore if */
        if (types.mapKey[keyType] === undefined)
            throw illegal(keyType, "type");

        skip(",");
        var valueType = next();

        /* istanbul ignore if */
        if (!typeRefRe.test(valueType))
            throw illegal(valueType, "type");

        skip(">");
        var name = next();

        /* istanbul ignore if */
        if (!nameRe.test(name))
            throw illegal(name, "name");

        skip("=");
        var field = new MapField(applyCase(name), parseId(next()), keyType, valueType);
        ifBlock(field, function parseMapField_block(token) {

            /* istanbul ignore else */
            if (token === "option") {
                parseOption(field, token);
                skip(";");
            } else
                throw illegal(token);

        }, function parseMapField_line() {
            parseInlineOptions(field);
        });
        parent.add(field);
    }

    function parseOneOf(parent, token) {

        /* istanbul ignore if */
        if (!nameRe.test(token = next()))
            throw illegal(token, "name");

        var oneof = new OneOf(applyCase(token));
        ifBlock(oneof, function parseOneOf_block(token) {
            if (token === "option") {
                parseOption(oneof, token);
                skip(";");
            } else {
                push(token);
                parseField(oneof, "optional");
            }
        });
        parent.add(oneof);
    }

    function parseEnum(parent, token) {

        /* istanbul ignore if */
        if (!nameRe.test(token = next()))
            throw illegal(token, "name");

        var enm = new Enum(token);
        ifBlock(enm, function parseEnum_block(token) {
          switch(token) {
            case "option":
              parseOption(enm, token);
              skip(";");
              break;

            case "reserved":
              readRanges(enm.reserved || (enm.reserved = []), true);
              break;

            default:
              parseEnumValue(enm, token);
          }
        });
        parent.add(enm);
    }

    function parseEnumValue(parent, token) {

        /* istanbul ignore if */
        if (!nameRe.test(token))
            throw illegal(token, "name");

        skip("=");
        var value = parseId(next(), true),
            dummy = {
                options: undefined
            };
        dummy.setOption = function(name, value) {
            if (this.options === undefined)
                this.options = {};
            this.options[name] = value;
        };
        ifBlock(dummy, function parseEnumValue_block(token) {

            /* istanbul ignore else */
            if (token === "option") {
                parseOption(dummy, token); // skip
                skip(";");
            } else
                throw illegal(token);

        }, function parseEnumValue_line() {
            parseInlineOptions(dummy); // skip
        });
        parent.add(token, value, dummy.comment, dummy.options);
    }

    function parseOption(parent, token) {
        var isCustom = skip("(", true);

        /* istanbul ignore if */
        if (!typeRefRe.test(token = next()))
            throw illegal(token, "name");

        var name = token;
        var option = name;
        var propName;

        if (isCustom) {
            skip(")");
            name = "(" + name + ")";
            option = name;
            token = peek();
            if (fqTypeRefRe.test(token)) {
                propName = token.slice(1); //remove '.' before property name
                name += token;
                next();
            }
        }
        skip("=");
        var optionValue = parseOptionValue(parent, name);
        setParsedOption(parent, option, optionValue, propName);
    }

    function parseOptionValue(parent, name) {
        // { a: "foo" b { c: "bar" } }
        if (skip("{", true)) {
            var objectResult = {};

            while (!skip("}", true)) {
                /* istanbul ignore if */
                if (!nameRe.test(token = next())) {
                    throw illegal(token, "name");
                }
                if (token === null) {
                  throw illegal(token, "end of input");
                }

                var value;
                var propName = token;

                skip(":", true);

                if (peek() === "{")
                    value = parseOptionValue(parent, name + "." + token);
                else if (peek() === "[") {
                    // option (my_option) = {
                    //     repeated_value: [ "foo", "bar" ]
                    // };
                    value = [];
                    var lastValue;
                    if (skip("[", true)) {
                        do {
                            lastValue = readValue(true);
                            value.push(lastValue);
                        } while (skip(",", true));
                        skip("]");
                        if (typeof lastValue !== "undefined") {
                            setOption(parent, name + "." + token, lastValue);
                        }
                    }
                } else {
                    value = readValue(true);
                    setOption(parent, name + "." + token, value);
                }

                var prevValue = objectResult[propName];

                if (prevValue)
                    value = [].concat(prevValue).concat(value);

                objectResult[propName] = value;

                // Semicolons and commas can be optional
                skip(",", true);
                skip(";", true);
            }

            return objectResult;
        }

        var simpleValue = readValue(true);
        setOption(parent, name, simpleValue);
        return simpleValue;
        // Does not enforce a delimiter to be universal
    }

    function setOption(parent, name, value) {
        if (parent.setOption)
            parent.setOption(name, value);
    }

    function setParsedOption(parent, name, value, propName) {
        if (parent.setParsedOption)
            parent.setParsedOption(name, value, propName);
    }

    function parseInlineOptions(parent) {
        if (skip("[", true)) {
            do {
                parseOption(parent, "option");
            } while (skip(",", true));
            skip("]");
        }
        return parent;
    }

    function parseService(parent, token) {

        /* istanbul ignore if */
        if (!nameRe.test(token = next()))
            throw illegal(token, "service name");

        var service = new Service(token);
        ifBlock(service, function parseService_block(token) {
            if (parseCommon(service, token))
                return;

            /* istanbul ignore else */
            if (token === "rpc")
                parseMethod(service, token);
            else
                throw illegal(token);
        });
        parent.add(service);
    }

    function parseMethod(parent, token) {
        // Get the comment of the preceding line now (if one exists) in case the
        // method is defined across multiple lines.
        var commentText = cmnt();

        var type = token;

        /* istanbul ignore if */
        if (!nameRe.test(token = next()))
            throw illegal(token, "name");

        var name = token,
            requestType, requestStream,
            responseType, responseStream;

        skip("(");
        if (skip("stream", true))
            requestStream = true;

        /* istanbul ignore if */
        if (!typeRefRe.test(token = next()))
            throw illegal(token);

        requestType = token;
        skip(")"); skip("returns"); skip("(");
        if (skip("stream", true))
            responseStream = true;

        /* istanbul ignore if */
        if (!typeRefRe.test(token = next()))
            throw illegal(token);

        responseType = token;
        skip(")");

        var method = new Method(name, type, requestType, responseType, requestStream, responseStream);
        method.comment = commentText;
        ifBlock(method, function parseMethod_block(token) {

            /* istanbul ignore else */
            if (token === "option") {
                parseOption(method, token);
                skip(";");
            } else
                throw illegal(token);

        });
        parent.add(method);
    }

    function parseExtension(parent, token) {

        /* istanbul ignore if */
        if (!typeRefRe.test(token = next()))
            throw illegal(token, "reference");

        var reference = token;
        ifBlock(null, function parseExtension_block(token) {
            switch (token) {

                case "required":
                case "repeated":
                    parseField(parent, token, reference);
                    break;

                case "optional":
                    /* istanbul ignore if */
                    if (isProto3) {
                        parseField(parent, "proto3_optional", reference);
                    } else {
                        parseField(parent, "optional", reference);
                    }
                    break;

                default:
                    /* istanbul ignore if */
                    if (!isProto3 || !typeRefRe.test(token))
                        throw illegal(token);
                    push(token);
                    parseField(parent, "optional", reference);
                    break;
            }
        });
    }

    var token;
    while ((token = next()) !== null) {
        switch (token) {

            case "package":

                /* istanbul ignore if */
                if (!head)
                    throw illegal(token);

                parsePackage();
                break;

            case "import":

                /* istanbul ignore if */
                if (!head)
                    throw illegal(token);

                parseImport();
                break;

            case "syntax":

                /* istanbul ignore if */
                if (!head)
                    throw illegal(token);

                parseSyntax();
                break;

            case "option":

                parseOption(ptr, token);
                skip(";");
                break;

            default:

                /* istanbul ignore else */
                if (parseCommon(ptr, token)) {
                    head = false;
                    continue;
                }

                /* istanbul ignore next */
                throw illegal(token);
        }
    }

    parse.filename = null;
    return {
        "package"     : pkg,
        "imports"     : imports,
         weakImports  : weakImports,
         syntax       : syntax,
         root         : root
    };
}

/**
 * Parses the given .proto source and returns an object with the parsed contents.
 * @name parse
 * @function
 * @param {string} source Source contents
 * @param {IParseOptions} [options] Parse options. Defaults to {@link parse.defaults} when omitted.
 * @returns {IParserResult} Parser result
 * @property {string} filename=null Currently processing file name for error reporting, if known
 * @property {IParseOptions} defaults Default {@link IParseOptions}
 * @variation 2
 */

},{"./enum":22,"./field":23,"./mapfield":27,"./method":29,"./oneof":32,"./root":36,"./service":40,"./tokenize":41,"./type":42,"./types":43,"./util":44}],34:[function(require,module,exports){
"use strict";
module.exports = Reader;

var util      = require("./util/minimal");

var BufferReader; // cyclic

var LongBits  = util.LongBits,
    utf8      = util.utf8;

/* istanbul ignore next */
function indexOutOfRange(reader, writeLength) {
    return RangeError("index out of range: " + reader.pos + " + " + (writeLength || 1) + " > " + reader.len);
}

/**
 * Constructs a new reader instance using the specified buffer.
 * @classdesc Wire format reader using `Uint8Array` if available, otherwise `Array`.
 * @constructor
 * @param {Uint8Array} buffer Buffer to read from
 */
function Reader(buffer) {

    /**
     * Read buffer.
     * @type {Uint8Array}
     */
    this.buf = buffer;

    /**
     * Read buffer position.
     * @type {number}
     */
    this.pos = 0;

    /**
     * Read buffer length.
     * @type {number}
     */
    this.len = buffer.length;
}

var create_array = typeof Uint8Array !== "undefined"
    ? function create_typed_array(buffer) {
        if (buffer instanceof Uint8Array || Array.isArray(buffer))
            return new Reader(buffer);
        throw Error("illegal buffer");
    }
    /* istanbul ignore next */
    : function create_array(buffer) {
        if (Array.isArray(buffer))
            return new Reader(buffer);
        throw Error("illegal buffer");
    };

var create = function create() {
    return util.Buffer
        ? function create_buffer_setup(buffer) {
            return (Reader.create = function create_buffer(buffer) {
                return util.Buffer.isBuffer(buffer)
                    ? new BufferReader(buffer)
                    /* istanbul ignore next */
                    : create_array(buffer);
            })(buffer);
        }
        /* istanbul ignore next */
        : create_array;
};

/**
 * Creates a new reader using the specified buffer.
 * @function
 * @param {Uint8Array|Buffer} buffer Buffer to read from
 * @returns {Reader|BufferReader} A {@link BufferReader} if `buffer` is a Buffer, otherwise a {@link Reader}
 * @throws {Error} If `buffer` is not a valid buffer
 */
Reader.create = create();

Reader.prototype._slice = util.Array.prototype.subarray || /* istanbul ignore next */ util.Array.prototype.slice;

/**
 * Reads a varint as an unsigned 32 bit value.
 * @function
 * @returns {number} Value read
 */
Reader.prototype.uint32 = (function read_uint32_setup() {
    var value = 4294967295; // optimizer type-hint, tends to deopt otherwise (?!)
    return function read_uint32() {
        value = (         this.buf[this.pos] & 127       ) >>> 0; if (this.buf[this.pos++] < 128) return value;
        value = (value | (this.buf[this.pos] & 127) <<  7) >>> 0; if (this.buf[this.pos++] < 128) return value;
        value = (value | (this.buf[this.pos] & 127) << 14) >>> 0; if (this.buf[this.pos++] < 128) return value;
        value = (value | (this.buf[this.pos] & 127) << 21) >>> 0; if (this.buf[this.pos++] < 128) return value;
        value = (value | (this.buf[this.pos] &  15) << 28) >>> 0; if (this.buf[this.pos++] < 128) return value;

        /* istanbul ignore if */
        if ((this.pos += 5) > this.len) {
            this.pos = this.len;
            throw indexOutOfRange(this, 10);
        }
        return value;
    };
})();

/**
 * Reads a varint as a signed 32 bit value.
 * @returns {number} Value read
 */
Reader.prototype.int32 = function read_int32() {
    return this.uint32() | 0;
};

/**
 * Reads a zig-zag encoded varint as a signed 32 bit value.
 * @returns {number} Value read
 */
Reader.prototype.sint32 = function read_sint32() {
    var value = this.uint32();
    return value >>> 1 ^ -(value & 1) | 0;
};

/* eslint-disable no-invalid-this */

function readLongVarint() {
    // tends to deopt with local vars for octet etc.
    var bits = new LongBits(0, 0);
    var i = 0;
    if (this.len - this.pos > 4) { // fast route (lo)
        for (; i < 4; ++i) {
            // 1st..4th
            bits.lo = (bits.lo | (this.buf[this.pos] & 127) << i * 7) >>> 0;
            if (this.buf[this.pos++] < 128)
                return bits;
        }
        // 5th
        bits.lo = (bits.lo | (this.buf[this.pos] & 127) << 28) >>> 0;
        bits.hi = (bits.hi | (this.buf[this.pos] & 127) >>  4) >>> 0;
        if (this.buf[this.pos++] < 128)
            return bits;
        i = 0;
    } else {
        for (; i < 3; ++i) {
            /* istanbul ignore if */
            if (this.pos >= this.len)
                throw indexOutOfRange(this);
            // 1st..3th
            bits.lo = (bits.lo | (this.buf[this.pos] & 127) << i * 7) >>> 0;
            if (this.buf[this.pos++] < 128)
                return bits;
        }
        // 4th
        bits.lo = (bits.lo | (this.buf[this.pos++] & 127) << i * 7) >>> 0;
        return bits;
    }
    if (this.len - this.pos > 4) { // fast route (hi)
        for (; i < 5; ++i) {
            // 6th..10th
            bits.hi = (bits.hi | (this.buf[this.pos] & 127) << i * 7 + 3) >>> 0;
            if (this.buf[this.pos++] < 128)
                return bits;
        }
    } else {
        for (; i < 5; ++i) {
            /* istanbul ignore if */
            if (this.pos >= this.len)
                throw indexOutOfRange(this);
            // 6th..10th
            bits.hi = (bits.hi | (this.buf[this.pos] & 127) << i * 7 + 3) >>> 0;
            if (this.buf[this.pos++] < 128)
                return bits;
        }
    }
    /* istanbul ignore next */
    throw Error("invalid varint encoding");
}

/* eslint-enable no-invalid-this */

/**
 * Reads a varint as a signed 64 bit value.
 * @name Reader#int64
 * @function
 * @returns {Long} Value read
 */

/**
 * Reads a varint as an unsigned 64 bit value.
 * @name Reader#uint64
 * @function
 * @returns {Long} Value read
 */

/**
 * Reads a zig-zag encoded varint as a signed 64 bit value.
 * @name Reader#sint64
 * @function
 * @returns {Long} Value read
 */

/**
 * Reads a varint as a boolean.
 * @returns {boolean} Value read
 */
Reader.prototype.bool = function read_bool() {
    return this.uint32() !== 0;
};

function readFixed32_end(buf, end) { // note that this uses `end`, not `pos`
    return (buf[end - 4]
          | buf[end - 3] << 8
          | buf[end - 2] << 16
          | buf[end - 1] << 24) >>> 0;
}

/**
 * Reads fixed 32 bits as an unsigned 32 bit integer.
 * @returns {number} Value read
 */
Reader.prototype.fixed32 = function read_fixed32() {

    /* istanbul ignore if */
    if (this.pos + 4 > this.len)
        throw indexOutOfRange(this, 4);

    return readFixed32_end(this.buf, this.pos += 4);
};

/**
 * Reads fixed 32 bits as a signed 32 bit integer.
 * @returns {number} Value read
 */
Reader.prototype.sfixed32 = function read_sfixed32() {

    /* istanbul ignore if */
    if (this.pos + 4 > this.len)
        throw indexOutOfRange(this, 4);

    return readFixed32_end(this.buf, this.pos += 4) | 0;
};

/* eslint-disable no-invalid-this */

function readFixed64(/* this: Reader */) {

    /* istanbul ignore if */
    if (this.pos + 8 > this.len)
        throw indexOutOfRange(this, 8);

    return new LongBits(readFixed32_end(this.buf, this.pos += 4), readFixed32_end(this.buf, this.pos += 4));
}

/* eslint-enable no-invalid-this */

/**
 * Reads fixed 64 bits.
 * @name Reader#fixed64
 * @function
 * @returns {Long} Value read
 */

/**
 * Reads zig-zag encoded fixed 64 bits.
 * @name Reader#sfixed64
 * @function
 * @returns {Long} Value read
 */

/**
 * Reads a float (32 bit) as a number.
 * @function
 * @returns {number} Value read
 */
Reader.prototype.float = function read_float() {

    /* istanbul ignore if */
    if (this.pos + 4 > this.len)
        throw indexOutOfRange(this, 4);

    var value = util.float.readFloatLE(this.buf, this.pos);
    this.pos += 4;
    return value;
};

/**
 * Reads a double (64 bit float) as a number.
 * @function
 * @returns {number} Value read
 */
Reader.prototype.double = function read_double() {

    /* istanbul ignore if */
    if (this.pos + 8 > this.len)
        throw indexOutOfRange(this, 4);

    var value = util.float.readDoubleLE(this.buf, this.pos);
    this.pos += 8;
    return value;
};

/**
 * Reads a sequence of bytes preceeded by its length as a varint.
 * @returns {Uint8Array} Value read
 */
Reader.prototype.bytes = function read_bytes() {
    var length = this.uint32(),
        start  = this.pos,
        end    = this.pos + length;

    /* istanbul ignore if */
    if (end > this.len)
        throw indexOutOfRange(this, length);

    this.pos += length;
    if (Array.isArray(this.buf)) // plain array
        return this.buf.slice(start, end);

    if (start === end) { // fix for IE 10/Win8 and others' subarray returning array of size 1
        var nativeBuffer = util.Buffer;
        return nativeBuffer
            ? nativeBuffer.alloc(0)
            : new this.buf.constructor(0);
    }
    return this._slice.call(this.buf, start, end);
};

/**
 * Reads a string preceeded by its byte length as a varint.
 * @returns {string} Value read
 */
Reader.prototype.string = function read_string() {
    var bytes = this.bytes();
    return utf8.read(bytes, 0, bytes.length);
};

/**
 * Skips the specified number of bytes if specified, otherwise skips a varint.
 * @param {number} [length] Length if known, otherwise a varint is assumed
 * @returns {Reader} `this`
 */
Reader.prototype.skip = function skip(length) {
    if (typeof length === "number") {
        /* istanbul ignore if */
        if (this.pos + length > this.len)
            throw indexOutOfRange(this, length);
        this.pos += length;
    } else {
        do {
            /* istanbul ignore if */
            if (this.pos >= this.len)
                throw indexOutOfRange(this);
        } while (this.buf[this.pos++] & 128);
    }
    return this;
};

/**
 * Skips the next element of the specified wire type.
 * @param {number} wireType Wire type received
 * @returns {Reader} `this`
 */
Reader.prototype.skipType = function(wireType) {
    switch (wireType) {
        case 0:
            this.skip();
            break;
        case 1:
            this.skip(8);
            break;
        case 2:
            this.skip(this.uint32());
            break;
        case 3:
            while ((wireType = this.uint32() & 7) !== 4) {
                this.skipType(wireType);
            }
            break;
        case 5:
            this.skip(4);
            break;

        /* istanbul ignore next */
        default:
            throw Error("invalid wire type " + wireType + " at offset " + this.pos);
    }
    return this;
};

Reader._configure = function(BufferReader_) {
    BufferReader = BufferReader_;
    Reader.create = create();
    BufferReader._configure();

    var fn = util.Long ? "toLong" : /* istanbul ignore next */ "toNumber";
    util.merge(Reader.prototype, {

        int64: function read_int64() {
            return readLongVarint.call(this)[fn](false);
        },

        uint64: function read_uint64() {
            return readLongVarint.call(this)[fn](true);
        },

        sint64: function read_sint64() {
            return readLongVarint.call(this).zzDecode()[fn](false);
        },

        fixed64: function read_fixed64() {
            return readFixed64.call(this)[fn](true);
        },

        sfixed64: function read_sfixed64() {
            return readFixed64.call(this)[fn](false);
        }

    });
};

},{"./util/minimal":46}],35:[function(require,module,exports){
"use strict";
module.exports = BufferReader;

// extends Reader
var Reader = require("./reader");
(BufferReader.prototype = Object.create(Reader.prototype)).constructor = BufferReader;

var util = require("./util/minimal");

/**
 * Constructs a new buffer reader instance.
 * @classdesc Wire format reader using node buffers.
 * @extends Reader
 * @constructor
 * @param {Buffer} buffer Buffer to read from
 */
function BufferReader(buffer) {
    Reader.call(this, buffer);

    /**
     * Read buffer.
     * @name BufferReader#buf
     * @type {Buffer}
     */
}

BufferReader._configure = function () {
    /* istanbul ignore else */
    if (util.Buffer)
        BufferReader.prototype._slice = util.Buffer.prototype.slice;
};


/**
 * @override
 */
BufferReader.prototype.string = function read_string_buffer() {
    var len = this.uint32(); // modifies pos
    return this.buf.utf8Slice
        ? this.buf.utf8Slice(this.pos, this.pos = Math.min(this.pos + len, this.len))
        : this.buf.toString("utf-8", this.pos, this.pos = Math.min(this.pos + len, this.len));
};

/**
 * Reads a sequence of bytes preceeded by its length as a varint.
 * @name BufferReader#bytes
 * @function
 * @returns {Buffer} Value read
 */

BufferReader._configure();

},{"./reader":34,"./util/minimal":46}],36:[function(require,module,exports){
"use strict";
module.exports = Root;

// extends Namespace
var Namespace = require("./namespace");
((Root.prototype = Object.create(Namespace.prototype)).constructor = Root).className = "Root";

var Field   = require("./field"),
    Enum    = require("./enum"),
    OneOf   = require("./oneof"),
    util    = require("./util");

var Type,   // cyclic
    parse,  // might be excluded
    common; // "

/**
 * Constructs a new root namespace instance.
 * @classdesc Root namespace wrapping all types, enums, services, sub-namespaces etc. that belong together.
 * @extends NamespaceBase
 * @constructor
 * @param {Object.<string,*>} [options] Top level options
 */
function Root(options) {
    Namespace.call(this, "", options);

    /**
     * Deferred extension fields.
     * @type {Field[]}
     */
    this.deferred = [];

    /**
     * Resolved file names of loaded files.
     * @type {string[]}
     */
    this.files = [];
}

/**
 * Loads a namespace descriptor into a root namespace.
 * @param {INamespace} json Nameespace descriptor
 * @param {Root} [root] Root namespace, defaults to create a new one if omitted
 * @returns {Root} Root namespace
 */
Root.fromJSON = function fromJSON(json, root) {
    if (!root)
        root = new Root();
    if (json.options)
        root.setOptions(json.options);
    return root.addJSON(json.nested);
};

/**
 * Resolves the path of an imported file, relative to the importing origin.
 * This method exists so you can override it with your own logic in case your imports are scattered over multiple directories.
 * @function
 * @param {string} origin The file name of the importing file
 * @param {string} target The file name being imported
 * @returns {string|null} Resolved path to `target` or `null` to skip the file
 */
Root.prototype.resolvePath = util.path.resolve;

/**
 * Fetch content from file path or url
 * This method exists so you can override it with your own logic.
 * @function
 * @param {string} path File path or url
 * @param {FetchCallback} callback Callback function
 * @returns {undefined}
 */
Root.prototype.fetch = util.fetch;

// A symbol-like function to safely signal synchronous loading
/* istanbul ignore next */
function SYNC() {} // eslint-disable-line no-empty-function

/**
 * Loads one or multiple .proto or preprocessed .json files into this root namespace and calls the callback.
 * @param {string|string[]} filename Names of one or multiple files to load
 * @param {IParseOptions} options Parse options
 * @param {LoadCallback} callback Callback function
 * @returns {undefined}
 */
Root.prototype.load = function load(filename, options, callback) {
    if (typeof options === "function") {
        callback = options;
        options = undefined;
    }
    var self = this;
    if (!callback)
        return util.asPromise(load, self, filename, options);

    var sync = callback === SYNC; // undocumented

    // Finishes loading by calling the callback (exactly once)
    function finish(err, root) {
        /* istanbul ignore if */
        if (!callback)
            return;
        if (sync)
            throw err;
        var cb = callback;
        callback = null;
        cb(err, root);
    }

    // Bundled definition existence checking
    function getBundledFileName(filename) {
        var idx = filename.lastIndexOf("google/protobuf/");
        if (idx > -1) {
            var altname = filename.substring(idx);
            if (altname in common) return altname;
        }
        return null;
    }

    // Processes a single file
    function process(filename, source) {
        try {
            if (util.isString(source) && source.charAt(0) === "{")
                source = JSON.parse(source);
            if (!util.isString(source))
                self.setOptions(source.options).addJSON(source.nested);
            else {
                parse.filename = filename;
                var parsed = parse(source, self, options),
                    resolved,
                    i = 0;
                if (parsed.imports)
                    for (; i < parsed.imports.length; ++i)
                        if (resolved = getBundledFileName(parsed.imports[i]) || self.resolvePath(filename, parsed.imports[i]))
                            fetch(resolved);
                if (parsed.weakImports)
                    for (i = 0; i < parsed.weakImports.length; ++i)
                        if (resolved = getBundledFileName(parsed.weakImports[i]) || self.resolvePath(filename, parsed.weakImports[i]))
                            fetch(resolved, true);
            }
        } catch (err) {
            finish(err);
        }
        if (!sync && !queued)
            finish(null, self); // only once anyway
    }

    // Fetches a single file
    function fetch(filename, weak) {
        filename = getBundledFileName(filename) || filename;

        // Skip if already loaded / attempted
        if (self.files.indexOf(filename) > -1)
            return;
        self.files.push(filename);

        // Shortcut bundled definitions
        if (filename in common) {
            if (sync)
                process(filename, common[filename]);
            else {
                ++queued;
                setTimeout(function() {
                    --queued;
                    process(filename, common[filename]);
                });
            }
            return;
        }

        // Otherwise fetch from disk or network
        if (sync) {
            var source;
            try {
                source = util.fs.readFileSync(filename).toString("utf8");
            } catch (err) {
                if (!weak)
                    finish(err);
                return;
            }
            process(filename, source);
        } else {
            ++queued;
            self.fetch(filename, function(err, source) {
                --queued;
                /* istanbul ignore if */
                if (!callback)
                    return; // terminated meanwhile
                if (err) {
                    /* istanbul ignore else */
                    if (!weak)
                        finish(err);
                    else if (!queued) // can't be covered reliably
                        finish(null, self);
                    return;
                }
                process(filename, source);
            });
        }
    }
    var queued = 0;

    // Assembling the root namespace doesn't require working type
    // references anymore, so we can load everything in parallel
    if (util.isString(filename))
        filename = [ filename ];
    for (var i = 0, resolved; i < filename.length; ++i)
        if (resolved = self.resolvePath("", filename[i]))
            fetch(resolved);

    if (sync)
        return self;
    if (!queued)
        finish(null, self);
    return undefined;
};
// function load(filename:string, options:IParseOptions, callback:LoadCallback):undefined

/**
 * Loads one or multiple .proto or preprocessed .json files into this root namespace and calls the callback.
 * @function Root#load
 * @param {string|string[]} filename Names of one or multiple files to load
 * @param {LoadCallback} callback Callback function
 * @returns {undefined}
 * @variation 2
 */
// function load(filename:string, callback:LoadCallback):undefined

/**
 * Loads one or multiple .proto or preprocessed .json files into this root namespace and returns a promise.
 * @function Root#load
 * @param {string|string[]} filename Names of one or multiple files to load
 * @param {IParseOptions} [options] Parse options. Defaults to {@link parse.defaults} when omitted.
 * @returns {Promise<Root>} Promise
 * @variation 3
 */
// function load(filename:string, [options:IParseOptions]):Promise<Root>

/**
 * Synchronously loads one or multiple .proto or preprocessed .json files into this root namespace (node only).
 * @function Root#loadSync
 * @param {string|string[]} filename Names of one or multiple files to load
 * @param {IParseOptions} [options] Parse options. Defaults to {@link parse.defaults} when omitted.
 * @returns {Root} Root namespace
 * @throws {Error} If synchronous fetching is not supported (i.e. in browsers) or if a file's syntax is invalid
 */
Root.prototype.loadSync = function loadSync(filename, options) {
    if (!util.isNode)
        throw Error("not supported");
    return this.load(filename, options, SYNC);
};

/**
 * @override
 */
Root.prototype.resolveAll = function resolveAll() {
    if (this.deferred.length)
        throw Error("unresolvable extensions: " + this.deferred.map(function(field) {
            return "'extend " + field.extend + "' in " + field.parent.fullName;
        }).join(", "));
    return Namespace.prototype.resolveAll.call(this);
};

// only uppercased (and thus conflict-free) children are exposed, see below
var exposeRe = /^[A-Z]/;

/**
 * Handles a deferred declaring extension field by creating a sister field to represent it within its extended type.
 * @param {Root} root Root instance
 * @param {Field} field Declaring extension field witin the declaring type
 * @returns {boolean} `true` if successfully added to the extended type, `false` otherwise
 * @inner
 * @ignore
 */
function tryHandleExtension(root, field) {
    var extendedType = field.parent.lookup(field.extend);
    if (extendedType) {
        var sisterField = new Field(field.fullName, field.id, field.type, field.rule, undefined, field.options);
        //do not allow to extend same field twice to prevent the error
        if (extendedType.get(sisterField.name)) {
            return true;
        }
        sisterField.declaringField = field;
        field.extensionField = sisterField;
        extendedType.add(sisterField);
        return true;
    }
    return false;
}

/**
 * Called when any object is added to this root or its sub-namespaces.
 * @param {ReflectionObject} object Object added
 * @returns {undefined}
 * @private
 */
Root.prototype._handleAdd = function _handleAdd(object) {
    if (object instanceof Field) {

        if (/* an extension field (implies not part of a oneof) */ object.extend !== undefined && /* not already handled */ !object.extensionField)
            if (!tryHandleExtension(this, object))
                this.deferred.push(object);

    } else if (object instanceof Enum) {

        if (exposeRe.test(object.name))
            object.parent[object.name] = object.values; // expose enum values as property of its parent

    } else if (!(object instanceof OneOf)) /* everything else is a namespace */ {

        if (object instanceof Type) // Try to handle any deferred extensions
            for (var i = 0; i < this.deferred.length;)
                if (tryHandleExtension(this, this.deferred[i]))
                    this.deferred.splice(i, 1);
                else
                    ++i;
        for (var j = 0; j < /* initializes */ object.nestedArray.length; ++j) // recurse into the namespace
            this._handleAdd(object._nestedArray[j]);
        if (exposeRe.test(object.name))
            object.parent[object.name] = object; // expose namespace as property of its parent
    }

    // The above also adds uppercased (and thus conflict-free) nested types, services and enums as
    // properties of namespaces just like static code does. This allows using a .d.ts generated for
    // a static module with reflection-based solutions where the condition is met.
};

/**
 * Called when any object is removed from this root or its sub-namespaces.
 * @param {ReflectionObject} object Object removed
 * @returns {undefined}
 * @private
 */
Root.prototype._handleRemove = function _handleRemove(object) {
    if (object instanceof Field) {

        if (/* an extension field */ object.extend !== undefined) {
            if (/* already handled */ object.extensionField) { // remove its sister field
                object.extensionField.parent.remove(object.extensionField);
                object.extensionField = null;
            } else { // cancel the extension
                var index = this.deferred.indexOf(object);
                /* istanbul ignore else */
                if (index > -1)
                    this.deferred.splice(index, 1);
            }
        }

    } else if (object instanceof Enum) {

        if (exposeRe.test(object.name))
            delete object.parent[object.name]; // unexpose enum values

    } else if (object instanceof Namespace) {

        for (var i = 0; i < /* initializes */ object.nestedArray.length; ++i) // recurse into the namespace
            this._handleRemove(object._nestedArray[i]);

        if (exposeRe.test(object.name))
            delete object.parent[object.name]; // unexpose namespaces

    }
};

// Sets up cyclic dependencies (called in index-light)
Root._configure = function(Type_, parse_, common_) {
    Type   = Type_;
    parse  = parse_;
    common = common_;
};

},{"./enum":22,"./field":23,"./namespace":30,"./oneof":32,"./util":44}],37:[function(require,module,exports){
"use strict";
module.exports = {};

/**
 * Named roots.
 * This is where pbjs stores generated structures (the option `-r, --root` specifies a name).
 * Can also be used manually to make roots available across modules.
 * @name roots
 * @type {Object.<string,Root>}
 * @example
 * // pbjs -r myroot -o compiled.js ...
 *
 * // in another module:
 * require("./compiled.js");
 *
 * // in any subsequent module:
 * var root = protobuf.roots["myroot"];
 */

},{}],38:[function(require,module,exports){
"use strict";

/**
 * Streaming RPC helpers.
 * @namespace
 */
var rpc = exports;

/**
 * RPC implementation passed to {@link Service#create} performing a service request on network level, i.e. by utilizing http requests or websockets.
 * @typedef RPCImpl
 * @type {function}
 * @param {Method|rpc.ServiceMethod<Message<{}>,Message<{}>>} method Reflected or static method being called
 * @param {Uint8Array} requestData Request data
 * @param {RPCImplCallback} callback Callback function
 * @returns {undefined}
 * @example
 * function rpcImpl(method, requestData, callback) {
 *     if (protobuf.util.lcFirst(method.name) !== "myMethod") // compatible with static code
 *         throw Error("no such method");
 *     asynchronouslyObtainAResponse(requestData, function(err, responseData) {
 *         callback(err, responseData);
 *     });
 * }
 */

/**
 * Node-style callback as used by {@link RPCImpl}.
 * @typedef RPCImplCallback
 * @type {function}
 * @param {Error|null} error Error, if any, otherwise `null`
 * @param {Uint8Array|null} [response] Response data or `null` to signal end of stream, if there hasn't been an error
 * @returns {undefined}
 */

rpc.Service = require("./rpc/service");

},{"./rpc/service":39}],39:[function(require,module,exports){
"use strict";
module.exports = Service;

var util = require("../util/minimal");

// Extends EventEmitter
(Service.prototype = Object.create(util.EventEmitter.prototype)).constructor = Service;

/**
 * A service method callback as used by {@link rpc.ServiceMethod|ServiceMethod}.
 *
 * Differs from {@link RPCImplCallback} in that it is an actual callback of a service method which may not return `response = null`.
 * @typedef rpc.ServiceMethodCallback
 * @template TRes extends Message<TRes>
 * @type {function}
 * @param {Error|null} error Error, if any
 * @param {TRes} [response] Response message
 * @returns {undefined}
 */

/**
 * A service method part of a {@link rpc.Service} as created by {@link Service.create}.
 * @typedef rpc.ServiceMethod
 * @template TReq extends Message<TReq>
 * @template TRes extends Message<TRes>
 * @type {function}
 * @param {TReq|Properties<TReq>} request Request message or plain object
 * @param {rpc.ServiceMethodCallback<TRes>} [callback] Node-style callback called with the error, if any, and the response message
 * @returns {Promise<Message<TRes>>} Promise if `callback` has been omitted, otherwise `undefined`
 */

/**
 * Constructs a new RPC service instance.
 * @classdesc An RPC service as returned by {@link Service#create}.
 * @exports rpc.Service
 * @extends util.EventEmitter
 * @constructor
 * @param {RPCImpl} rpcImpl RPC implementation
 * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
 * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
 */
function Service(rpcImpl, requestDelimited, responseDelimited) {

    if (typeof rpcImpl !== "function")
        throw TypeError("rpcImpl must be a function");

    util.EventEmitter.call(this);

    /**
     * RPC implementation. Becomes `null` once the service is ended.
     * @type {RPCImpl|null}
     */
    this.rpcImpl = rpcImpl;

    /**
     * Whether requests are length-delimited.
     * @type {boolean}
     */
    this.requestDelimited = Boolean(requestDelimited);

    /**
     * Whether responses are length-delimited.
     * @type {boolean}
     */
    this.responseDelimited = Boolean(responseDelimited);
}

/**
 * Calls a service method through {@link rpc.Service#rpcImpl|rpcImpl}.
 * @param {Method|rpc.ServiceMethod<TReq,TRes>} method Reflected or static method
 * @param {Constructor<TReq>} requestCtor Request constructor
 * @param {Constructor<TRes>} responseCtor Response constructor
 * @param {TReq|Properties<TReq>} request Request message or plain object
 * @param {rpc.ServiceMethodCallback<TRes>} callback Service callback
 * @returns {undefined}
 * @template TReq extends Message<TReq>
 * @template TRes extends Message<TRes>
 */
Service.prototype.rpcCall = function rpcCall(method, requestCtor, responseCtor, request, callback) {

    if (!request)
        throw TypeError("request must be specified");

    var self = this;
    if (!callback)
        return util.asPromise(rpcCall, self, method, requestCtor, responseCtor, request);

    if (!self.rpcImpl) {
        setTimeout(function() { callback(Error("already ended")); }, 0);
        return undefined;
    }

    try {
        return self.rpcImpl(
            method,
            requestCtor[self.requestDelimited ? "encodeDelimited" : "encode"](request).finish(),
            function rpcCallback(err, response) {

                if (err) {
                    self.emit("error", err, method);
                    return callback(err);
                }

                if (response === null) {
                    self.end(/* endedByRPC */ true);
                    return undefined;
                }

                if (!(response instanceof responseCtor)) {
                    try {
                        response = responseCtor[self.responseDelimited ? "decodeDelimited" : "decode"](response);
                    } catch (err) {
                        self.emit("error", err, method);
                        return callback(err);
                    }
                }

                self.emit("data", response, method);
                return callback(null, response);
            }
        );
    } catch (err) {
        self.emit("error", err, method);
        setTimeout(function() { callback(err); }, 0);
        return undefined;
    }
};

/**
 * Ends this service and emits the `end` event.
 * @param {boolean} [endedByRPC=false] Whether the service has been ended by the RPC implementation.
 * @returns {rpc.Service} `this`
 */
Service.prototype.end = function end(endedByRPC) {
    if (this.rpcImpl) {
        if (!endedByRPC) // signal end to rpcImpl
            this.rpcImpl(null, null, null);
        this.rpcImpl = null;
        this.emit("end").off();
    }
    return this;
};

},{"../util/minimal":46}],40:[function(require,module,exports){
"use strict";
module.exports = Service;

// extends Namespace
var Namespace = require("./namespace");
((Service.prototype = Object.create(Namespace.prototype)).constructor = Service).className = "Service";

var Method = require("./method"),
    util   = require("./util"),
    rpc    = require("./rpc");

/**
 * Constructs a new service instance.
 * @classdesc Reflected service.
 * @extends NamespaceBase
 * @constructor
 * @param {string} name Service name
 * @param {Object.<string,*>} [options] Service options
 * @throws {TypeError} If arguments are invalid
 */
function Service(name, options) {
    Namespace.call(this, name, options);

    /**
     * Service methods.
     * @type {Object.<string,Method>}
     */
    this.methods = {}; // toJSON, marker

    /**
     * Cached methods as an array.
     * @type {Method[]|null}
     * @private
     */
    this._methodsArray = null;
}

/**
 * Service descriptor.
 * @interface IService
 * @extends INamespace
 * @property {Object.<string,IMethod>} methods Method descriptors
 */

/**
 * Constructs a service from a service descriptor.
 * @param {string} name Service name
 * @param {IService} json Service descriptor
 * @returns {Service} Created service
 * @throws {TypeError} If arguments are invalid
 */
Service.fromJSON = function fromJSON(name, json) {
    var service = new Service(name, json.options);
    /* istanbul ignore else */
    if (json.methods)
        for (var names = Object.keys(json.methods), i = 0; i < names.length; ++i)
            service.add(Method.fromJSON(names[i], json.methods[names[i]]));
    if (json.nested)
        service.addJSON(json.nested);
    service.comment = json.comment;
    return service;
};

/**
 * Converts this service to a service descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IService} Service descriptor
 */
Service.prototype.toJSON = function toJSON(toJSONOptions) {
    var inherited = Namespace.prototype.toJSON.call(this, toJSONOptions);
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "options" , inherited && inherited.options || undefined,
        "methods" , Namespace.arrayToJSON(this.methodsArray, toJSONOptions) || /* istanbul ignore next */ {},
        "nested"  , inherited && inherited.nested || undefined,
        "comment" , keepComments ? this.comment : undefined
    ]);
};

/**
 * Methods of this service as an array for iteration.
 * @name Service#methodsArray
 * @type {Method[]}
 * @readonly
 */
Object.defineProperty(Service.prototype, "methodsArray", {
    get: function() {
        return this._methodsArray || (this._methodsArray = util.toArray(this.methods));
    }
});

function clearCache(service) {
    service._methodsArray = null;
    return service;
}

/**
 * @override
 */
Service.prototype.get = function get(name) {
    return this.methods[name]
        || Namespace.prototype.get.call(this, name);
};

/**
 * @override
 */
Service.prototype.resolveAll = function resolveAll() {
    var methods = this.methodsArray;
    for (var i = 0; i < methods.length; ++i)
        methods[i].resolve();
    return Namespace.prototype.resolve.call(this);
};

/**
 * @override
 */
Service.prototype.add = function add(object) {

    /* istanbul ignore if */
    if (this.get(object.name))
        throw Error("duplicate name '" + object.name + "' in " + this);

    if (object instanceof Method) {
        this.methods[object.name] = object;
        object.parent = this;
        return clearCache(this);
    }
    return Namespace.prototype.add.call(this, object);
};

/**
 * @override
 */
Service.prototype.remove = function remove(object) {
    if (object instanceof Method) {

        /* istanbul ignore if */
        if (this.methods[object.name] !== object)
            throw Error(object + " is not a member of " + this);

        delete this.methods[object.name];
        object.parent = null;
        return clearCache(this);
    }
    return Namespace.prototype.remove.call(this, object);
};

/**
 * Creates a runtime service using the specified rpc implementation.
 * @param {RPCImpl} rpcImpl RPC implementation
 * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
 * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
 * @returns {rpc.Service} RPC service. Useful where requests and/or responses are streamed.
 */
Service.prototype.create = function create(rpcImpl, requestDelimited, responseDelimited) {
    var rpcService = new rpc.Service(rpcImpl, requestDelimited, responseDelimited);
    for (var i = 0, method; i < /* initializes */ this.methodsArray.length; ++i) {
        var methodName = util.lcFirst((method = this._methodsArray[i]).resolve().name).replace(/[^$\w_]/g, "");
        rpcService[methodName] = util.codegen(["r","c"], util.isReserved(methodName) ? methodName + "_" : methodName)("return this.rpcCall(m,q,s,r,c)")({
            m: method,
            q: method.resolvedRequestType.ctor,
            s: method.resolvedResponseType.ctor
        });
    }
    return rpcService;
};

},{"./method":29,"./namespace":30,"./rpc":38,"./util":44}],41:[function(require,module,exports){
"use strict";
module.exports = tokenize;

var delimRe        = /[\s{}=;:[\],'"()<>]/g,
    stringDoubleRe = /(?:"([^"\\]*(?:\\.[^"\\]*)*)")/g,
    stringSingleRe = /(?:'([^'\\]*(?:\\.[^'\\]*)*)')/g;

var setCommentRe = /^ *[*/]+ */,
    setCommentAltRe = /^\s*\*?\/*/,
    setCommentSplitRe = /\n/g,
    whitespaceRe = /\s/,
    unescapeRe = /\\(.?)/g;

var unescapeMap = {
    "0": "\0",
    "r": "\r",
    "n": "\n",
    "t": "\t"
};

/**
 * Unescapes a string.
 * @param {string} str String to unescape
 * @returns {string} Unescaped string
 * @property {Object.<string,string>} map Special characters map
 * @memberof tokenize
 */
function unescape(str) {
    return str.replace(unescapeRe, function($0, $1) {
        switch ($1) {
            case "\\":
            case "":
                return $1;
            default:
                return unescapeMap[$1] || "";
        }
    });
}

tokenize.unescape = unescape;

/**
 * Gets the next token and advances.
 * @typedef TokenizerHandleNext
 * @type {function}
 * @returns {string|null} Next token or `null` on eof
 */

/**
 * Peeks for the next token.
 * @typedef TokenizerHandlePeek
 * @type {function}
 * @returns {string|null} Next token or `null` on eof
 */

/**
 * Pushes a token back to the stack.
 * @typedef TokenizerHandlePush
 * @type {function}
 * @param {string} token Token
 * @returns {undefined}
 */

/**
 * Skips the next token.
 * @typedef TokenizerHandleSkip
 * @type {function}
 * @param {string} expected Expected token
 * @param {boolean} [optional=false] If optional
 * @returns {boolean} Whether the token matched
 * @throws {Error} If the token didn't match and is not optional
 */

/**
 * Gets the comment on the previous line or, alternatively, the line comment on the specified line.
 * @typedef TokenizerHandleCmnt
 * @type {function}
 * @param {number} [line] Line number
 * @returns {string|null} Comment text or `null` if none
 */

/**
 * Handle object returned from {@link tokenize}.
 * @interface ITokenizerHandle
 * @property {TokenizerHandleNext} next Gets the next token and advances (`null` on eof)
 * @property {TokenizerHandlePeek} peek Peeks for the next token (`null` on eof)
 * @property {TokenizerHandlePush} push Pushes a token back to the stack
 * @property {TokenizerHandleSkip} skip Skips a token, returns its presence and advances or, if non-optional and not present, throws
 * @property {TokenizerHandleCmnt} cmnt Gets the comment on the previous line or the line comment on the specified line, if any
 * @property {number} line Current line number
 */

/**
 * Tokenizes the given .proto source and returns an object with useful utility functions.
 * @param {string} source Source contents
 * @param {boolean} alternateCommentMode Whether we should activate alternate comment parsing mode.
 * @returns {ITokenizerHandle} Tokenizer handle
 */
function tokenize(source, alternateCommentMode) {
    /* eslint-disable callback-return */
    source = source.toString();

    var offset = 0,
        length = source.length,
        line = 1,
        lastCommentLine = 0,
        comments = {};

    var stack = [];

    var stringDelim = null;

    /* istanbul ignore next */
    /**
     * Creates an error for illegal syntax.
     * @param {string} subject Subject
     * @returns {Error} Error created
     * @inner
     */
    function illegal(subject) {
        return Error("illegal " + subject + " (line " + line + ")");
    }

    /**
     * Reads a string till its end.
     * @returns {string} String read
     * @inner
     */
    function readString() {
        var re = stringDelim === "'" ? stringSingleRe : stringDoubleRe;
        re.lastIndex = offset - 1;
        var match = re.exec(source);
        if (!match)
            throw illegal("string");
        offset = re.lastIndex;
        push(stringDelim);
        stringDelim = null;
        return unescape(match[1]);
    }

    /**
     * Gets the character at `pos` within the source.
     * @param {number} pos Position
     * @returns {string} Character
     * @inner
     */
    function charAt(pos) {
        return source.charAt(pos);
    }

    /**
     * Sets the current comment text.
     * @param {number} start Start offset
     * @param {number} end End offset
     * @param {boolean} isLeading set if a leading comment
     * @returns {undefined}
     * @inner
     */
    function setComment(start, end, isLeading) {
        var comment = {
            type: source.charAt(start++),
            lineEmpty: false,
            leading: isLeading,
        };
        var lookback;
        if (alternateCommentMode) {
            lookback = 2;  // alternate comment parsing: "//" or "/*"
        } else {
            lookback = 3;  // "///" or "/**"
        }
        var commentOffset = start - lookback,
            c;
        do {
            if (--commentOffset < 0 ||
                    (c = source.charAt(commentOffset)) === "\n") {
                comment.lineEmpty = true;
                break;
            }
        } while (c === " " || c === "\t");
        var lines = source
            .substring(start, end)
            .split(setCommentSplitRe);
        for (var i = 0; i < lines.length; ++i)
            lines[i] = lines[i]
                .replace(alternateCommentMode ? setCommentAltRe : setCommentRe, "")
                .trim();
        comment.text = lines
            .join("\n")
            .trim();

        comments[line] = comment;
        lastCommentLine = line;
    }

    function isDoubleSlashCommentLine(startOffset) {
        var endOffset = findEndOfLine(startOffset);

        // see if remaining line matches comment pattern
        var lineText = source.substring(startOffset, endOffset);
        var isComment = /^\s*\/\//.test(lineText);
        return isComment;
    }

    function findEndOfLine(cursor) {
        // find end of cursor's line
        var endOffset = cursor;
        while (endOffset < length && charAt(endOffset) !== "\n") {
            endOffset++;
        }
        return endOffset;
    }

    /**
     * Obtains the next token.
     * @returns {string|null} Next token or `null` on eof
     * @inner
     */
    function next() {
        if (stack.length > 0)
            return stack.shift();
        if (stringDelim)
            return readString();
        var repeat,
            prev,
            curr,
            start,
            isDoc,
            isLeadingComment = offset === 0;
        do {
            if (offset === length)
                return null;
            repeat = false;
            while (whitespaceRe.test(curr = charAt(offset))) {
                if (curr === "\n") {
                    isLeadingComment = true;
                    ++line;
                }
                if (++offset === length)
                    return null;
            }

            if (charAt(offset) === "/") {
                if (++offset === length) {
                    throw illegal("comment");
                }
                if (charAt(offset) === "/") { // Line
                    if (!alternateCommentMode) {
                        // check for triple-slash comment
                        isDoc = charAt(start = offset + 1) === "/";

                        while (charAt(++offset) !== "\n") {
                            if (offset === length) {
                                return null;
                            }
                        }
                        ++offset;
                        if (isDoc) {
                            setComment(start, offset - 1, isLeadingComment);
                            // Trailing comment cannot not be multi-line,
                            // so leading comment state should be reset to handle potential next comments
                            isLeadingComment = true;
                        }
                        ++line;
                        repeat = true;
                    } else {
                        // check for double-slash comments, consolidating consecutive lines
                        start = offset;
                        isDoc = false;
                        if (isDoubleSlashCommentLine(offset - 1)) {
                            isDoc = true;
                            do {
                                offset = findEndOfLine(offset);
                                if (offset === length) {
                                    break;
                                }
                                offset++;
                                if (!isLeadingComment) {
                                    // Trailing comment cannot not be multi-line
                                    break;
                                }
                            } while (isDoubleSlashCommentLine(offset));
                        } else {
                            offset = Math.min(length, findEndOfLine(offset) + 1);
                        }
                        if (isDoc) {
                            setComment(start, offset, isLeadingComment);
                            isLeadingComment = true;
                        }
                        line++;
                        repeat = true;
                    }
                } else if ((curr = charAt(offset)) === "*") { /* Block */
                    // check for /** (regular comment mode) or /* (alternate comment mode)
                    start = offset + 1;
                    isDoc = alternateCommentMode || charAt(start) === "*";
                    do {
                        if (curr === "\n") {
                            ++line;
                        }
                        if (++offset === length) {
                            throw illegal("comment");
                        }
                        prev = curr;
                        curr = charAt(offset);
                    } while (prev !== "*" || curr !== "/");
                    ++offset;
                    if (isDoc) {
                        setComment(start, offset - 2, isLeadingComment);
                        isLeadingComment = true;
                    }
                    repeat = true;
                } else {
                    return "/";
                }
            }
        } while (repeat);

        // offset !== length if we got here

        var end = offset;
        delimRe.lastIndex = 0;
        var delim = delimRe.test(charAt(end++));
        if (!delim)
            while (end < length && !delimRe.test(charAt(end)))
                ++end;
        var token = source.substring(offset, offset = end);
        if (token === "\"" || token === "'")
            stringDelim = token;
        return token;
    }

    /**
     * Pushes a token back to the stack.
     * @param {string} token Token
     * @returns {undefined}
     * @inner
     */
    function push(token) {
        stack.push(token);
    }

    /**
     * Peeks for the next token.
     * @returns {string|null} Token or `null` on eof
     * @inner
     */
    function peek() {
        if (!stack.length) {
            var token = next();
            if (token === null)
                return null;
            push(token);
        }
        return stack[0];
    }

    /**
     * Skips a token.
     * @param {string} expected Expected token
     * @param {boolean} [optional=false] Whether the token is optional
     * @returns {boolean} `true` when skipped, `false` if not
     * @throws {Error} When a required token is not present
     * @inner
     */
    function skip(expected, optional) {
        var actual = peek(),
            equals = actual === expected;
        if (equals) {
            next();
            return true;
        }
        if (!optional)
            throw illegal("token '" + actual + "', '" + expected + "' expected");
        return false;
    }

    /**
     * Gets a comment.
     * @param {number} [trailingLine] Line number if looking for a trailing comment
     * @returns {string|null} Comment text
     * @inner
     */
    function cmnt(trailingLine) {
        var ret = null;
        var comment;
        if (trailingLine === undefined) {
            comment = comments[line - 1];
            delete comments[line - 1];
            if (comment && (alternateCommentMode || comment.type === "*" || comment.lineEmpty)) {
                ret = comment.leading ? comment.text : null;
            }
        } else {
            /* istanbul ignore else */
            if (lastCommentLine < trailingLine) {
                peek();
            }
            comment = comments[trailingLine];
            delete comments[trailingLine];
            if (comment && !comment.lineEmpty && (alternateCommentMode || comment.type === "/")) {
                ret = comment.leading ? null : comment.text;
            }
        }
        return ret;
    }

    return Object.defineProperty({
        next: next,
        peek: peek,
        push: push,
        skip: skip,
        cmnt: cmnt
    }, "line", {
        get: function() { return line; }
    });
    /* eslint-enable callback-return */
}

},{}],42:[function(require,module,exports){
"use strict";
module.exports = Type;

// extends Namespace
var Namespace = require("./namespace");
((Type.prototype = Object.create(Namespace.prototype)).constructor = Type).className = "Type";

var Enum      = require("./enum"),
    OneOf     = require("./oneof"),
    Field     = require("./field"),
    MapField  = require("./mapfield"),
    Service   = require("./service"),
    Message   = require("./message"),
    Reader    = require("./reader"),
    Writer    = require("./writer"),
    util      = require("./util"),
    encoder   = require("./encoder"),
    decoder   = require("./decoder"),
    verifier  = require("./verifier"),
    converter = require("./converter"),
    wrappers  = require("./wrappers");

/**
 * Constructs a new reflected message type instance.
 * @classdesc Reflected message type.
 * @extends NamespaceBase
 * @constructor
 * @param {string} name Message name
 * @param {Object.<string,*>} [options] Declared options
 */
function Type(name, options) {
    Namespace.call(this, name, options);

    /**
     * Message fields.
     * @type {Object.<string,Field>}
     */
    this.fields = {};  // toJSON, marker

    /**
     * Oneofs declared within this namespace, if any.
     * @type {Object.<string,OneOf>}
     */
    this.oneofs = undefined; // toJSON

    /**
     * Extension ranges, if any.
     * @type {number[][]}
     */
    this.extensions = undefined; // toJSON

    /**
     * Reserved ranges, if any.
     * @type {Array.<number[]|string>}
     */
    this.reserved = undefined; // toJSON

    /*?
     * Whether this type is a legacy group.
     * @type {boolean|undefined}
     */
    this.group = undefined; // toJSON

    /**
     * Cached fields by id.
     * @type {Object.<number,Field>|null}
     * @private
     */
    this._fieldsById = null;

    /**
     * Cached fields as an array.
     * @type {Field[]|null}
     * @private
     */
    this._fieldsArray = null;

    /**
     * Cached oneofs as an array.
     * @type {OneOf[]|null}
     * @private
     */
    this._oneofsArray = null;

    /**
     * Cached constructor.
     * @type {Constructor<{}>}
     * @private
     */
    this._ctor = null;
}

Object.defineProperties(Type.prototype, {

    /**
     * Message fields by id.
     * @name Type#fieldsById
     * @type {Object.<number,Field>}
     * @readonly
     */
    fieldsById: {
        get: function() {

            /* istanbul ignore if */
            if (this._fieldsById)
                return this._fieldsById;

            this._fieldsById = {};
            for (var names = Object.keys(this.fields), i = 0; i < names.length; ++i) {
                var field = this.fields[names[i]],
                    id = field.id;

                /* istanbul ignore if */
                if (this._fieldsById[id])
                    throw Error("duplicate id " + id + " in " + this);

                this._fieldsById[id] = field;
            }
            return this._fieldsById;
        }
    },

    /**
     * Fields of this message as an array for iteration.
     * @name Type#fieldsArray
     * @type {Field[]}
     * @readonly
     */
    fieldsArray: {
        get: function() {
            return this._fieldsArray || (this._fieldsArray = util.toArray(this.fields));
        }
    },

    /**
     * Oneofs of this message as an array for iteration.
     * @name Type#oneofsArray
     * @type {OneOf[]}
     * @readonly
     */
    oneofsArray: {
        get: function() {
            return this._oneofsArray || (this._oneofsArray = util.toArray(this.oneofs));
        }
    },

    /**
     * The registered constructor, if any registered, otherwise a generic constructor.
     * Assigning a function replaces the internal constructor. If the function does not extend {@link Message} yet, its prototype will be setup accordingly and static methods will be populated. If it already extends {@link Message}, it will just replace the internal constructor.
     * @name Type#ctor
     * @type {Constructor<{}>}
     */
    ctor: {
        get: function() {
            return this._ctor || (this.ctor = Type.generateConstructor(this)());
        },
        set: function(ctor) {

            // Ensure proper prototype
            var prototype = ctor.prototype;
            if (!(prototype instanceof Message)) {
                (ctor.prototype = new Message()).constructor = ctor;
                util.merge(ctor.prototype, prototype);
            }

            // Classes and messages reference their reflected type
            ctor.$type = ctor.prototype.$type = this;

            // Mix in static methods
            util.merge(ctor, Message, true);

            this._ctor = ctor;

            // Messages have non-enumerable default values on their prototype
            var i = 0;
            for (; i < /* initializes */ this.fieldsArray.length; ++i)
                this._fieldsArray[i].resolve(); // ensures a proper value

            // Messages have non-enumerable getters and setters for each virtual oneof field
            var ctorProperties = {};
            for (i = 0; i < /* initializes */ this.oneofsArray.length; ++i)
                ctorProperties[this._oneofsArray[i].resolve().name] = {
                    get: util.oneOfGetter(this._oneofsArray[i].oneof),
                    set: util.oneOfSetter(this._oneofsArray[i].oneof)
                };
            if (i)
                Object.defineProperties(ctor.prototype, ctorProperties);
        }
    }
});

/**
 * Generates a constructor function for the specified type.
 * @param {Type} mtype Message type
 * @returns {Codegen} Codegen instance
 */
Type.generateConstructor = function generateConstructor(mtype) {
    /* eslint-disable no-unexpected-multiline */
    var gen = util.codegen(["p"], mtype.name);
    // explicitly initialize mutable object/array fields so that these aren't just inherited from the prototype
    for (var i = 0, field; i < mtype.fieldsArray.length; ++i)
        if ((field = mtype._fieldsArray[i]).map) gen
            ("this%s={}", util.safeProp(field.name));
        else if (field.repeated) gen
            ("this%s=[]", util.safeProp(field.name));
    return gen
    ("if(p)for(var ks=Object.keys(p),i=0;i<ks.length;++i)if(p[ks[i]]!=null)") // omit undefined or null
        ("this[ks[i]]=p[ks[i]]");
    /* eslint-enable no-unexpected-multiline */
};

function clearCache(type) {
    type._fieldsById = type._fieldsArray = type._oneofsArray = null;
    delete type.encode;
    delete type.decode;
    delete type.verify;
    return type;
}

/**
 * Message type descriptor.
 * @interface IType
 * @extends INamespace
 * @property {Object.<string,IOneOf>} [oneofs] Oneof descriptors
 * @property {Object.<string,IField>} fields Field descriptors
 * @property {number[][]} [extensions] Extension ranges
 * @property {Array.<number[]|string>} [reserved] Reserved ranges
 * @property {boolean} [group=false] Whether a legacy group or not
 */

/**
 * Creates a message type from a message type descriptor.
 * @param {string} name Message name
 * @param {IType} json Message type descriptor
 * @returns {Type} Created message type
 */
Type.fromJSON = function fromJSON(name, json) {
    var type = new Type(name, json.options);
    type.extensions = json.extensions;
    type.reserved = json.reserved;
    var names = Object.keys(json.fields),
        i = 0;
    for (; i < names.length; ++i)
        type.add(
            ( typeof json.fields[names[i]].keyType !== "undefined"
            ? MapField.fromJSON
            : Field.fromJSON )(names[i], json.fields[names[i]])
        );
    if (json.oneofs)
        for (names = Object.keys(json.oneofs), i = 0; i < names.length; ++i)
            type.add(OneOf.fromJSON(names[i], json.oneofs[names[i]]));
    if (json.nested)
        for (names = Object.keys(json.nested), i = 0; i < names.length; ++i) {
            var nested = json.nested[names[i]];
            type.add( // most to least likely
                ( nested.id !== undefined
                ? Field.fromJSON
                : nested.fields !== undefined
                ? Type.fromJSON
                : nested.values !== undefined
                ? Enum.fromJSON
                : nested.methods !== undefined
                ? Service.fromJSON
                : Namespace.fromJSON )(names[i], nested)
            );
        }
    if (json.extensions && json.extensions.length)
        type.extensions = json.extensions;
    if (json.reserved && json.reserved.length)
        type.reserved = json.reserved;
    if (json.group)
        type.group = true;
    if (json.comment)
        type.comment = json.comment;
    return type;
};

/**
 * Converts this message type to a message type descriptor.
 * @param {IToJSONOptions} [toJSONOptions] JSON conversion options
 * @returns {IType} Message type descriptor
 */
Type.prototype.toJSON = function toJSON(toJSONOptions) {
    var inherited = Namespace.prototype.toJSON.call(this, toJSONOptions);
    var keepComments = toJSONOptions ? Boolean(toJSONOptions.keepComments) : false;
    return util.toObject([
        "options"    , inherited && inherited.options || undefined,
        "oneofs"     , Namespace.arrayToJSON(this.oneofsArray, toJSONOptions),
        "fields"     , Namespace.arrayToJSON(this.fieldsArray.filter(function(obj) { return !obj.declaringField; }), toJSONOptions) || {},
        "extensions" , this.extensions && this.extensions.length ? this.extensions : undefined,
        "reserved"   , this.reserved && this.reserved.length ? this.reserved : undefined,
        "group"      , this.group || undefined,
        "nested"     , inherited && inherited.nested || undefined,
        "comment"    , keepComments ? this.comment : undefined
    ]);
};

/**
 * @override
 */
Type.prototype.resolveAll = function resolveAll() {
    var fields = this.fieldsArray, i = 0;
    while (i < fields.length)
        fields[i++].resolve();
    var oneofs = this.oneofsArray; i = 0;
    while (i < oneofs.length)
        oneofs[i++].resolve();
    return Namespace.prototype.resolveAll.call(this);
};

/**
 * @override
 */
Type.prototype.get = function get(name) {
    return this.fields[name]
        || this.oneofs && this.oneofs[name]
        || this.nested && this.nested[name]
        || null;
};

/**
 * Adds a nested object to this type.
 * @param {ReflectionObject} object Nested object to add
 * @returns {Type} `this`
 * @throws {TypeError} If arguments are invalid
 * @throws {Error} If there is already a nested object with this name or, if a field, when there is already a field with this id
 */
Type.prototype.add = function add(object) {

    if (this.get(object.name))
        throw Error("duplicate name '" + object.name + "' in " + this);

    if (object instanceof Field && object.extend === undefined) {
        // NOTE: Extension fields aren't actual fields on the declaring type, but nested objects.
        // The root object takes care of adding distinct sister-fields to the respective extended
        // type instead.

        // avoids calling the getter if not absolutely necessary because it's called quite frequently
        if (this._fieldsById ? /* istanbul ignore next */ this._fieldsById[object.id] : this.fieldsById[object.id])
            throw Error("duplicate id " + object.id + " in " + this);
        if (this.isReservedId(object.id))
            throw Error("id " + object.id + " is reserved in " + this);
        if (this.isReservedName(object.name))
            throw Error("name '" + object.name + "' is reserved in " + this);

        if (object.parent)
            object.parent.remove(object);
        this.fields[object.name] = object;
        object.message = this;
        object.onAdd(this);
        return clearCache(this);
    }
    if (object instanceof OneOf) {
        if (!this.oneofs)
            this.oneofs = {};
        this.oneofs[object.name] = object;
        object.onAdd(this);
        return clearCache(this);
    }
    return Namespace.prototype.add.call(this, object);
};

/**
 * Removes a nested object from this type.
 * @param {ReflectionObject} object Nested object to remove
 * @returns {Type} `this`
 * @throws {TypeError} If arguments are invalid
 * @throws {Error} If `object` is not a member of this type
 */
Type.prototype.remove = function remove(object) {
    if (object instanceof Field && object.extend === undefined) {
        // See Type#add for the reason why extension fields are excluded here.

        /* istanbul ignore if */
        if (!this.fields || this.fields[object.name] !== object)
            throw Error(object + " is not a member of " + this);

        delete this.fields[object.name];
        object.parent = null;
        object.onRemove(this);
        return clearCache(this);
    }
    if (object instanceof OneOf) {

        /* istanbul ignore if */
        if (!this.oneofs || this.oneofs[object.name] !== object)
            throw Error(object + " is not a member of " + this);

        delete this.oneofs[object.name];
        object.parent = null;
        object.onRemove(this);
        return clearCache(this);
    }
    return Namespace.prototype.remove.call(this, object);
};

/**
 * Tests if the specified id is reserved.
 * @param {number} id Id to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
Type.prototype.isReservedId = function isReservedId(id) {
    return Namespace.isReservedId(this.reserved, id);
};

/**
 * Tests if the specified name is reserved.
 * @param {string} name Name to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
Type.prototype.isReservedName = function isReservedName(name) {
    return Namespace.isReservedName(this.reserved, name);
};

/**
 * Creates a new message of this type using the specified properties.
 * @param {Object.<string,*>} [properties] Properties to set
 * @returns {Message<{}>} Message instance
 */
Type.prototype.create = function create(properties) {
    return new this.ctor(properties);
};

/**
 * Sets up {@link Type#encode|encode}, {@link Type#decode|decode} and {@link Type#verify|verify}.
 * @returns {Type} `this`
 */
Type.prototype.setup = function setup() {
    // Sets up everything at once so that the prototype chain does not have to be re-evaluated
    // multiple times (V8, soft-deopt prototype-check).

    var fullName = this.fullName,
        types    = [];
    for (var i = 0; i < /* initializes */ this.fieldsArray.length; ++i)
        types.push(this._fieldsArray[i].resolve().resolvedType);

    // Replace setup methods with type-specific generated functions
    this.encode = encoder(this)({
        Writer : Writer,
        types  : types,
        util   : util
    });
    this.decode = decoder(this)({
        Reader : Reader,
        types  : types,
        util   : util
    });
    this.verify = verifier(this)({
        types : types,
        util  : util
    });
    this.fromObject = converter.fromObject(this)({
        types : types,
        util  : util
    });
    this.toObject = converter.toObject(this)({
        types : types,
        util  : util
    });

    // Inject custom wrappers for common types
    var wrapper = wrappers[fullName];
    if (wrapper) {
        var originalThis = Object.create(this);
        // if (wrapper.fromObject) {
            originalThis.fromObject = this.fromObject;
            this.fromObject = wrapper.fromObject.bind(originalThis);
        // }
        // if (wrapper.toObject) {
            originalThis.toObject = this.toObject;
            this.toObject = wrapper.toObject.bind(originalThis);
        // }
    }

    return this;
};

/**
 * Encodes a message of this type. Does not implicitly {@link Type#verify|verify} messages.
 * @param {Message<{}>|Object.<string,*>} message Message instance or plain object
 * @param {Writer} [writer] Writer to encode to
 * @returns {Writer} writer
 */
Type.prototype.encode = function encode_setup(message, writer) {
    return this.setup().encode(message, writer); // overrides this method
};

/**
 * Encodes a message of this type preceeded by its byte length as a varint. Does not implicitly {@link Type#verify|verify} messages.
 * @param {Message<{}>|Object.<string,*>} message Message instance or plain object
 * @param {Writer} [writer] Writer to encode to
 * @returns {Writer} writer
 */
Type.prototype.encodeDelimited = function encodeDelimited(message, writer) {
    return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
};

/**
 * Decodes a message of this type.
 * @param {Reader|Uint8Array} reader Reader or buffer to decode from
 * @param {number} [length] Length of the message, if known beforehand
 * @returns {Message<{}>} Decoded message
 * @throws {Error} If the payload is not a reader or valid buffer
 * @throws {util.ProtocolError<{}>} If required fields are missing
 */
Type.prototype.decode = function decode_setup(reader, length) {
    return this.setup().decode(reader, length); // overrides this method
};

/**
 * Decodes a message of this type preceeded by its byte length as a varint.
 * @param {Reader|Uint8Array} reader Reader or buffer to decode from
 * @returns {Message<{}>} Decoded message
 * @throws {Error} If the payload is not a reader or valid buffer
 * @throws {util.ProtocolError} If required fields are missing
 */
Type.prototype.decodeDelimited = function decodeDelimited(reader) {
    if (!(reader instanceof Reader))
        reader = Reader.create(reader);
    return this.decode(reader, reader.uint32());
};

/**
 * Verifies that field values are valid and that required fields are present.
 * @param {Object.<string,*>} message Plain object to verify
 * @returns {null|string} `null` if valid, otherwise the reason why it is not
 */
Type.prototype.verify = function verify_setup(message) {
    return this.setup().verify(message); // overrides this method
};

/**
 * Creates a new message of this type from a plain object. Also converts values to their respective internal types.
 * @param {Object.<string,*>} object Plain object to convert
 * @returns {Message<{}>} Message instance
 */
Type.prototype.fromObject = function fromObject(object) {
    return this.setup().fromObject(object);
};

/**
 * Conversion options as used by {@link Type#toObject} and {@link Message.toObject}.
 * @interface IConversionOptions
 * @property {Function} [longs] Long conversion type.
 * Valid values are `String` and `Number` (the global types).
 * Defaults to copy the present value, which is a possibly unsafe number without and a {@link Long} with a long library.
 * @property {Function} [enums] Enum value conversion type.
 * Only valid value is `String` (the global type).
 * Defaults to copy the present value, which is the numeric id.
 * @property {Function} [bytes] Bytes value conversion type.
 * Valid values are `Array` and (a base64 encoded) `String` (the global types).
 * Defaults to copy the present value, which usually is a Buffer under node and an Uint8Array in the browser.
 * @property {boolean} [defaults=false] Also sets default values on the resulting object
 * @property {boolean} [arrays=false] Sets empty arrays for missing repeated fields even if `defaults=false`
 * @property {boolean} [objects=false] Sets empty objects for missing map fields even if `defaults=false`
 * @property {boolean} [oneofs=false] Includes virtual oneof properties set to the present field's name, if any
 * @property {boolean} [json=false] Performs additional JSON compatibility conversions, i.e. NaN and Infinity to strings
 */

/**
 * Creates a plain object from a message of this type. Also converts values to other types if specified.
 * @param {Message<{}>} message Message instance
 * @param {IConversionOptions} [options] Conversion options
 * @returns {Object.<string,*>} Plain object
 */
Type.prototype.toObject = function toObject(message, options) {
    return this.setup().toObject(message, options);
};

/**
 * Decorator function as returned by {@link Type.d} (TypeScript).
 * @typedef TypeDecorator
 * @type {function}
 * @param {Constructor<T>} target Target constructor
 * @returns {undefined}
 * @template T extends Message<T>
 */

/**
 * Type decorator (TypeScript).
 * @param {string} [typeName] Type name, defaults to the constructor's name
 * @returns {TypeDecorator<T>} Decorator function
 * @template T extends Message<T>
 */
Type.d = function decorateType(typeName) {
    return function typeDecorator(target) {
        util.decorateType(target, typeName);
    };
};

},{"./converter":19,"./decoder":20,"./encoder":21,"./enum":22,"./field":23,"./mapfield":27,"./message":28,"./namespace":30,"./oneof":32,"./reader":34,"./service":40,"./util":44,"./verifier":47,"./wrappers":48,"./writer":49}],43:[function(require,module,exports){
"use strict";

/**
 * Common type constants.
 * @namespace
 */
var types = exports;

var util = require("./util");

var s = [
    "double",   // 0
    "float",    // 1
    "int32",    // 2
    "uint32",   // 3
    "sint32",   // 4
    "fixed32",  // 5
    "sfixed32", // 6
    "int64",    // 7
    "uint64",   // 8
    "sint64",   // 9
    "fixed64",  // 10
    "sfixed64", // 11
    "bool",     // 12
    "string",   // 13
    "bytes"     // 14
];

function bake(values, offset) {
    var i = 0, o = {};
    offset |= 0;
    while (i < values.length) o[s[i + offset]] = values[i++];
    return o;
}

/**
 * Basic type wire types.
 * @type {Object.<string,number>}
 * @const
 * @property {number} double=1 Fixed64 wire type
 * @property {number} float=5 Fixed32 wire type
 * @property {number} int32=0 Varint wire type
 * @property {number} uint32=0 Varint wire type
 * @property {number} sint32=0 Varint wire type
 * @property {number} fixed32=5 Fixed32 wire type
 * @property {number} sfixed32=5 Fixed32 wire type
 * @property {number} int64=0 Varint wire type
 * @property {number} uint64=0 Varint wire type
 * @property {number} sint64=0 Varint wire type
 * @property {number} fixed64=1 Fixed64 wire type
 * @property {number} sfixed64=1 Fixed64 wire type
 * @property {number} bool=0 Varint wire type
 * @property {number} string=2 Ldelim wire type
 * @property {number} bytes=2 Ldelim wire type
 */
types.basic = bake([
    /* double   */ 1,
    /* float    */ 5,
    /* int32    */ 0,
    /* uint32   */ 0,
    /* sint32   */ 0,
    /* fixed32  */ 5,
    /* sfixed32 */ 5,
    /* int64    */ 0,
    /* uint64   */ 0,
    /* sint64   */ 0,
    /* fixed64  */ 1,
    /* sfixed64 */ 1,
    /* bool     */ 0,
    /* string   */ 2,
    /* bytes    */ 2
]);

/**
 * Basic type defaults.
 * @type {Object.<string,*>}
 * @const
 * @property {number} double=0 Double default
 * @property {number} float=0 Float default
 * @property {number} int32=0 Int32 default
 * @property {number} uint32=0 Uint32 default
 * @property {number} sint32=0 Sint32 default
 * @property {number} fixed32=0 Fixed32 default
 * @property {number} sfixed32=0 Sfixed32 default
 * @property {number} int64=0 Int64 default
 * @property {number} uint64=0 Uint64 default
 * @property {number} sint64=0 Sint32 default
 * @property {number} fixed64=0 Fixed64 default
 * @property {number} sfixed64=0 Sfixed64 default
 * @property {boolean} bool=false Bool default
 * @property {string} string="" String default
 * @property {Array.<number>} bytes=Array(0) Bytes default
 * @property {null} message=null Message default
 */
types.defaults = bake([
    /* double   */ 0,
    /* float    */ 0,
    /* int32    */ 0,
    /* uint32   */ 0,
    /* sint32   */ 0,
    /* fixed32  */ 0,
    /* sfixed32 */ 0,
    /* int64    */ 0,
    /* uint64   */ 0,
    /* sint64   */ 0,
    /* fixed64  */ 0,
    /* sfixed64 */ 0,
    /* bool     */ false,
    /* string   */ "",
    /* bytes    */ util.emptyArray,
    /* message  */ null
]);

/**
 * Basic long type wire types.
 * @type {Object.<string,number>}
 * @const
 * @property {number} int64=0 Varint wire type
 * @property {number} uint64=0 Varint wire type
 * @property {number} sint64=0 Varint wire type
 * @property {number} fixed64=1 Fixed64 wire type
 * @property {number} sfixed64=1 Fixed64 wire type
 */
types.long = bake([
    /* int64    */ 0,
    /* uint64   */ 0,
    /* sint64   */ 0,
    /* fixed64  */ 1,
    /* sfixed64 */ 1
], 7);

/**
 * Allowed types for map keys with their associated wire type.
 * @type {Object.<string,number>}
 * @const
 * @property {number} int32=0 Varint wire type
 * @property {number} uint32=0 Varint wire type
 * @property {number} sint32=0 Varint wire type
 * @property {number} fixed32=5 Fixed32 wire type
 * @property {number} sfixed32=5 Fixed32 wire type
 * @property {number} int64=0 Varint wire type
 * @property {number} uint64=0 Varint wire type
 * @property {number} sint64=0 Varint wire type
 * @property {number} fixed64=1 Fixed64 wire type
 * @property {number} sfixed64=1 Fixed64 wire type
 * @property {number} bool=0 Varint wire type
 * @property {number} string=2 Ldelim wire type
 */
types.mapKey = bake([
    /* int32    */ 0,
    /* uint32   */ 0,
    /* sint32   */ 0,
    /* fixed32  */ 5,
    /* sfixed32 */ 5,
    /* int64    */ 0,
    /* uint64   */ 0,
    /* sint64   */ 0,
    /* fixed64  */ 1,
    /* sfixed64 */ 1,
    /* bool     */ 0,
    /* string   */ 2
], 2);

/**
 * Allowed types for packed repeated fields with their associated wire type.
 * @type {Object.<string,number>}
 * @const
 * @property {number} double=1 Fixed64 wire type
 * @property {number} float=5 Fixed32 wire type
 * @property {number} int32=0 Varint wire type
 * @property {number} uint32=0 Varint wire type
 * @property {number} sint32=0 Varint wire type
 * @property {number} fixed32=5 Fixed32 wire type
 * @property {number} sfixed32=5 Fixed32 wire type
 * @property {number} int64=0 Varint wire type
 * @property {number} uint64=0 Varint wire type
 * @property {number} sint64=0 Varint wire type
 * @property {number} fixed64=1 Fixed64 wire type
 * @property {number} sfixed64=1 Fixed64 wire type
 * @property {number} bool=0 Varint wire type
 */
types.packed = bake([
    /* double   */ 1,
    /* float    */ 5,
    /* int32    */ 0,
    /* uint32   */ 0,
    /* sint32   */ 0,
    /* fixed32  */ 5,
    /* sfixed32 */ 5,
    /* int64    */ 0,
    /* uint64   */ 0,
    /* sint64   */ 0,
    /* fixed64  */ 1,
    /* sfixed64 */ 1,
    /* bool     */ 0
]);

},{"./util":44}],44:[function(require,module,exports){
"use strict";

/**
 * Various utility functions.
 * @namespace
 */
var util = module.exports = require("./util/minimal");

var roots = require("./roots");

var Type, // cyclic
    Enum;

util.codegen = require("@protobufjs/codegen");
util.fetch   = require("@protobufjs/fetch");
util.path    = require("@protobufjs/path");

/**
 * Node's fs module if available.
 * @type {Object.<string,*>}
 */
util.fs = util.inquire("fs");

/**
 * Converts an object's values to an array.
 * @param {Object.<string,*>} object Object to convert
 * @returns {Array.<*>} Converted array
 */
util.toArray = function toArray(object) {
    if (object) {
        var keys  = Object.keys(object),
            array = new Array(keys.length),
            index = 0;
        while (index < keys.length)
            array[index] = object[keys[index++]];
        return array;
    }
    return [];
};

/**
 * Converts an array of keys immediately followed by their respective value to an object, omitting undefined values.
 * @param {Array.<*>} array Array to convert
 * @returns {Object.<string,*>} Converted object
 */
util.toObject = function toObject(array) {
    var object = {},
        index  = 0;
    while (index < array.length) {
        var key = array[index++],
            val = array[index++];
        if (val !== undefined)
            object[key] = val;
    }
    return object;
};

var safePropBackslashRe = /\\/g,
    safePropQuoteRe     = /"/g;

/**
 * Tests whether the specified name is a reserved word in JS.
 * @param {string} name Name to test
 * @returns {boolean} `true` if reserved, otherwise `false`
 */
util.isReserved = function isReserved(name) {
    return /^(?:do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/.test(name);
};

/**
 * Returns a safe property accessor for the specified property name.
 * @param {string} prop Property name
 * @returns {string} Safe accessor
 */
util.safeProp = function safeProp(prop) {
    if (!/^[$\w_]+$/.test(prop) || util.isReserved(prop))
        return "[\"" + prop.replace(safePropBackslashRe, "\\\\").replace(safePropQuoteRe, "\\\"") + "\"]";
    return "." + prop;
};

/**
 * Converts the first character of a string to upper case.
 * @param {string} str String to convert
 * @returns {string} Converted string
 */
util.ucFirst = function ucFirst(str) {
    return str.charAt(0).toUpperCase() + str.substring(1);
};

var camelCaseRe = /_([a-z])/g;

/**
 * Converts a string to camel case.
 * @param {string} str String to convert
 * @returns {string} Converted string
 */
util.camelCase = function camelCase(str) {
    return str.substring(0, 1)
         + str.substring(1)
               .replace(camelCaseRe, function($0, $1) { return $1.toUpperCase(); });
};

/**
 * Compares reflected fields by id.
 * @param {Field} a First field
 * @param {Field} b Second field
 * @returns {number} Comparison value
 */
util.compareFieldsById = function compareFieldsById(a, b) {
    return a.id - b.id;
};

/**
 * Decorator helper for types (TypeScript).
 * @param {Constructor<T>} ctor Constructor function
 * @param {string} [typeName] Type name, defaults to the constructor's name
 * @returns {Type} Reflected type
 * @template T extends Message<T>
 * @property {Root} root Decorators root
 */
util.decorateType = function decorateType(ctor, typeName) {

    /* istanbul ignore if */
    if (ctor.$type) {
        if (typeName && ctor.$type.name !== typeName) {
            util.decorateRoot.remove(ctor.$type);
            ctor.$type.name = typeName;
            util.decorateRoot.add(ctor.$type);
        }
        return ctor.$type;
    }

    /* istanbul ignore next */
    if (!Type)
        Type = require("./type");

    var type = new Type(typeName || ctor.name);
    util.decorateRoot.add(type);
    type.ctor = ctor; // sets up .encode, .decode etc.
    Object.defineProperty(ctor, "$type", { value: type, enumerable: false });
    Object.defineProperty(ctor.prototype, "$type", { value: type, enumerable: false });
    return type;
};

var decorateEnumIndex = 0;

/**
 * Decorator helper for enums (TypeScript).
 * @param {Object} object Enum object
 * @returns {Enum} Reflected enum
 */
util.decorateEnum = function decorateEnum(object) {

    /* istanbul ignore if */
    if (object.$type)
        return object.$type;

    /* istanbul ignore next */
    if (!Enum)
        Enum = require("./enum");

    var enm = new Enum("Enum" + decorateEnumIndex++, object);
    util.decorateRoot.add(enm);
    Object.defineProperty(object, "$type", { value: enm, enumerable: false });
    return enm;
};


/**
 * Sets the value of a property by property path. If a value already exists, it is turned to an array
 * @param {Object.<string,*>} dst Destination object
 * @param {string} path dot '.' delimited path of the property to set
 * @param {Object} value the value to set
 * @returns {Object.<string,*>} Destination object
 */
util.setProperty = function setProperty(dst, path, value) {
    function setProp(dst, path, value) {
        var part = path.shift();
        if (part === "__proto__" || part === "prototype") {
          return dst;
        }
        if (path.length > 0) {
            dst[part] = setProp(dst[part] || {}, path, value);
        } else {
            var prevValue = dst[part];
            if (prevValue)
                value = [].concat(prevValue).concat(value);
            dst[part] = value;
        }
        return dst;
    }

    if (typeof dst !== "object")
        throw TypeError("dst must be an object");
    if (!path)
        throw TypeError("path must be specified");

    path = path.split(".");
    return setProp(dst, path, value);
};

/**
 * Decorator root (TypeScript).
 * @name util.decorateRoot
 * @type {Root}
 * @readonly
 */
Object.defineProperty(util, "decorateRoot", {
    get: function() {
        return roots["decorated"] || (roots["decorated"] = new (require("./root"))());
    }
});

},{"./enum":22,"./root":36,"./roots":37,"./type":42,"./util/minimal":46,"@protobufjs/codegen":5,"@protobufjs/fetch":7,"@protobufjs/path":10}],45:[function(require,module,exports){
"use strict";
module.exports = LongBits;

var util = require("../util/minimal");

/**
 * Constructs new long bits.
 * @classdesc Helper class for working with the low and high bits of a 64 bit value.
 * @memberof util
 * @constructor
 * @param {number} lo Low 32 bits, unsigned
 * @param {number} hi High 32 bits, unsigned
 */
function LongBits(lo, hi) {

    // note that the casts below are theoretically unnecessary as of today, but older statically
    // generated converter code might still call the ctor with signed 32bits. kept for compat.

    /**
     * Low bits.
     * @type {number}
     */
    this.lo = lo >>> 0;

    /**
     * High bits.
     * @type {number}
     */
    this.hi = hi >>> 0;
}

/**
 * Zero bits.
 * @memberof util.LongBits
 * @type {util.LongBits}
 */
var zero = LongBits.zero = new LongBits(0, 0);

zero.toNumber = function() { return 0; };
zero.zzEncode = zero.zzDecode = function() { return this; };
zero.length = function() { return 1; };

/**
 * Zero hash.
 * @memberof util.LongBits
 * @type {string}
 */
var zeroHash = LongBits.zeroHash = "\0\0\0\0\0\0\0\0";

/**
 * Constructs new long bits from the specified number.
 * @param {number} value Value
 * @returns {util.LongBits} Instance
 */
LongBits.fromNumber = function fromNumber(value) {
    if (value === 0)
        return zero;
    var sign = value < 0;
    if (sign)
        value = -value;
    var lo = value >>> 0,
        hi = (value - lo) / 4294967296 >>> 0;
    if (sign) {
        hi = ~hi >>> 0;
        lo = ~lo >>> 0;
        if (++lo > 4294967295) {
            lo = 0;
            if (++hi > 4294967295)
                hi = 0;
        }
    }
    return new LongBits(lo, hi);
};

/**
 * Constructs new long bits from a number, long or string.
 * @param {Long|number|string} value Value
 * @returns {util.LongBits} Instance
 */
LongBits.from = function from(value) {
    if (typeof value === "number")
        return LongBits.fromNumber(value);
    if (util.isString(value)) {
        /* istanbul ignore else */
        if (util.Long)
            value = util.Long.fromString(value);
        else
            return LongBits.fromNumber(parseInt(value, 10));
    }
    return value.low || value.high ? new LongBits(value.low >>> 0, value.high >>> 0) : zero;
};

/**
 * Converts this long bits to a possibly unsafe JavaScript number.
 * @param {boolean} [unsigned=false] Whether unsigned or not
 * @returns {number} Possibly unsafe number
 */
LongBits.prototype.toNumber = function toNumber(unsigned) {
    if (!unsigned && this.hi >>> 31) {
        var lo = ~this.lo + 1 >>> 0,
            hi = ~this.hi     >>> 0;
        if (!lo)
            hi = hi + 1 >>> 0;
        return -(lo + hi * 4294967296);
    }
    return this.lo + this.hi * 4294967296;
};

/**
 * Converts this long bits to a long.
 * @param {boolean} [unsigned=false] Whether unsigned or not
 * @returns {Long} Long
 */
LongBits.prototype.toLong = function toLong(unsigned) {
    return util.Long
        ? new util.Long(this.lo | 0, this.hi | 0, Boolean(unsigned))
        /* istanbul ignore next */
        : { low: this.lo | 0, high: this.hi | 0, unsigned: Boolean(unsigned) };
};

var charCodeAt = String.prototype.charCodeAt;

/**
 * Constructs new long bits from the specified 8 characters long hash.
 * @param {string} hash Hash
 * @returns {util.LongBits} Bits
 */
LongBits.fromHash = function fromHash(hash) {
    if (hash === zeroHash)
        return zero;
    return new LongBits(
        ( charCodeAt.call(hash, 0)
        | charCodeAt.call(hash, 1) << 8
        | charCodeAt.call(hash, 2) << 16
        | charCodeAt.call(hash, 3) << 24) >>> 0
    ,
        ( charCodeAt.call(hash, 4)
        | charCodeAt.call(hash, 5) << 8
        | charCodeAt.call(hash, 6) << 16
        | charCodeAt.call(hash, 7) << 24) >>> 0
    );
};

/**
 * Converts this long bits to a 8 characters long hash.
 * @returns {string} Hash
 */
LongBits.prototype.toHash = function toHash() {
    return String.fromCharCode(
        this.lo        & 255,
        this.lo >>> 8  & 255,
        this.lo >>> 16 & 255,
        this.lo >>> 24      ,
        this.hi        & 255,
        this.hi >>> 8  & 255,
        this.hi >>> 16 & 255,
        this.hi >>> 24
    );
};

/**
 * Zig-zag encodes this long bits.
 * @returns {util.LongBits} `this`
 */
LongBits.prototype.zzEncode = function zzEncode() {
    var mask =   this.hi >> 31;
    this.hi  = ((this.hi << 1 | this.lo >>> 31) ^ mask) >>> 0;
    this.lo  = ( this.lo << 1                   ^ mask) >>> 0;
    return this;
};

/**
 * Zig-zag decodes this long bits.
 * @returns {util.LongBits} `this`
 */
LongBits.prototype.zzDecode = function zzDecode() {
    var mask = -(this.lo & 1);
    this.lo  = ((this.lo >>> 1 | this.hi << 31) ^ mask) >>> 0;
    this.hi  = ( this.hi >>> 1                  ^ mask) >>> 0;
    return this;
};

/**
 * Calculates the length of this longbits when encoded as a varint.
 * @returns {number} Length
 */
LongBits.prototype.length = function length() {
    var part0 =  this.lo,
        part1 = (this.lo >>> 28 | this.hi << 4) >>> 0,
        part2 =  this.hi >>> 24;
    return part2 === 0
         ? part1 === 0
           ? part0 < 16384
             ? part0 < 128 ? 1 : 2
             : part0 < 2097152 ? 3 : 4
           : part1 < 16384
             ? part1 < 128 ? 5 : 6
             : part1 < 2097152 ? 7 : 8
         : part2 < 128 ? 9 : 10;
};

},{"../util/minimal":46}],46:[function(require,module,exports){
(function (global){(function (){
"use strict";
var util = exports;

// used to return a Promise where callback is omitted
util.asPromise = require("@protobufjs/aspromise");

// converts to / from base64 encoded strings
util.base64 = require("@protobufjs/base64");

// base class of rpc.Service
util.EventEmitter = require("@protobufjs/eventemitter");

// float handling accross browsers
util.float = require("@protobufjs/float");

// requires modules optionally and hides the call from bundlers
util.inquire = require("@protobufjs/inquire");

// converts to / from utf8 encoded strings
util.utf8 = require("@protobufjs/utf8");

// provides a node-like buffer pool in the browser
util.pool = require("@protobufjs/pool");

// utility to work with the low and high bits of a 64 bit value
util.LongBits = require("./longbits");

/**
 * Whether running within node or not.
 * @memberof util
 * @type {boolean}
 */
util.isNode = Boolean(typeof global !== "undefined"
                   && global
                   && global.process
                   && global.process.versions
                   && global.process.versions.node);

/**
 * Global object reference.
 * @memberof util
 * @type {Object}
 */
util.global = util.isNode && global
           || typeof window !== "undefined" && window
           || typeof self   !== "undefined" && self
           || this; // eslint-disable-line no-invalid-this

/**
 * An immuable empty array.
 * @memberof util
 * @type {Array.<*>}
 * @const
 */
util.emptyArray = Object.freeze ? Object.freeze([]) : /* istanbul ignore next */ []; // used on prototypes

/**
 * An immutable empty object.
 * @type {Object}
 * @const
 */
util.emptyObject = Object.freeze ? Object.freeze({}) : /* istanbul ignore next */ {}; // used on prototypes

/**
 * Tests if the specified value is an integer.
 * @function
 * @param {*} value Value to test
 * @returns {boolean} `true` if the value is an integer
 */
util.isInteger = Number.isInteger || /* istanbul ignore next */ function isInteger(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
};

/**
 * Tests if the specified value is a string.
 * @param {*} value Value to test
 * @returns {boolean} `true` if the value is a string
 */
util.isString = function isString(value) {
    return typeof value === "string" || value instanceof String;
};

/**
 * Tests if the specified value is a non-null object.
 * @param {*} value Value to test
 * @returns {boolean} `true` if the value is a non-null object
 */
util.isObject = function isObject(value) {
    return value && typeof value === "object";
};

/**
 * Checks if a property on a message is considered to be present.
 * This is an alias of {@link util.isSet}.
 * @function
 * @param {Object} obj Plain object or message instance
 * @param {string} prop Property name
 * @returns {boolean} `true` if considered to be present, otherwise `false`
 */
util.isset =

/**
 * Checks if a property on a message is considered to be present.
 * @param {Object} obj Plain object or message instance
 * @param {string} prop Property name
 * @returns {boolean} `true` if considered to be present, otherwise `false`
 */
util.isSet = function isSet(obj, prop) {
    var value = obj[prop];
    if (value != null && obj.hasOwnProperty(prop)) // eslint-disable-line eqeqeq, no-prototype-builtins
        return typeof value !== "object" || (Array.isArray(value) ? value.length : Object.keys(value).length) > 0;
    return false;
};

/**
 * Any compatible Buffer instance.
 * This is a minimal stand-alone definition of a Buffer instance. The actual type is that exported by node's typings.
 * @interface Buffer
 * @extends Uint8Array
 */

/**
 * Node's Buffer class if available.
 * @type {Constructor<Buffer>}
 */
util.Buffer = (function() {
    try {
        var Buffer = util.inquire("buffer").Buffer;
        // refuse to use non-node buffers if not explicitly assigned (perf reasons):
        return Buffer.prototype.utf8Write ? Buffer : /* istanbul ignore next */ null;
    } catch (e) {
        /* istanbul ignore next */
        return null;
    }
})();

// Internal alias of or polyfull for Buffer.from.
util._Buffer_from = null;

// Internal alias of or polyfill for Buffer.allocUnsafe.
util._Buffer_allocUnsafe = null;

/**
 * Creates a new buffer of whatever type supported by the environment.
 * @param {number|number[]} [sizeOrArray=0] Buffer size or number array
 * @returns {Uint8Array|Buffer} Buffer
 */
util.newBuffer = function newBuffer(sizeOrArray) {
    /* istanbul ignore next */
    return typeof sizeOrArray === "number"
        ? util.Buffer
            ? util._Buffer_allocUnsafe(sizeOrArray)
            : new util.Array(sizeOrArray)
        : util.Buffer
            ? util._Buffer_from(sizeOrArray)
            : typeof Uint8Array === "undefined"
                ? sizeOrArray
                : new Uint8Array(sizeOrArray);
};

/**
 * Array implementation used in the browser. `Uint8Array` if supported, otherwise `Array`.
 * @type {Constructor<Uint8Array>}
 */
util.Array = typeof Uint8Array !== "undefined" ? Uint8Array /* istanbul ignore next */ : Array;

/**
 * Any compatible Long instance.
 * This is a minimal stand-alone definition of a Long instance. The actual type is that exported by long.js.
 * @interface Long
 * @property {number} low Low bits
 * @property {number} high High bits
 * @property {boolean} unsigned Whether unsigned or not
 */

/**
 * Long.js's Long class if available.
 * @type {Constructor<Long>}
 */
util.Long = /* istanbul ignore next */ util.global.dcodeIO && /* istanbul ignore next */ util.global.dcodeIO.Long
         || /* istanbul ignore next */ util.global.Long
         || util.inquire("long");

/**
 * Regular expression used to verify 2 bit (`bool`) map keys.
 * @type {RegExp}
 * @const
 */
util.key2Re = /^true|false|0|1$/;

/**
 * Regular expression used to verify 32 bit (`int32` etc.) map keys.
 * @type {RegExp}
 * @const
 */
util.key32Re = /^-?(?:0|[1-9][0-9]*)$/;

/**
 * Regular expression used to verify 64 bit (`int64` etc.) map keys.
 * @type {RegExp}
 * @const
 */
util.key64Re = /^(?:[\\x00-\\xff]{8}|-?(?:0|[1-9][0-9]*))$/;

/**
 * Converts a number or long to an 8 characters long hash string.
 * @param {Long|number} value Value to convert
 * @returns {string} Hash
 */
util.longToHash = function longToHash(value) {
    return value
        ? util.LongBits.from(value).toHash()
        : util.LongBits.zeroHash;
};

/**
 * Converts an 8 characters long hash string to a long or number.
 * @param {string} hash Hash
 * @param {boolean} [unsigned=false] Whether unsigned or not
 * @returns {Long|number} Original value
 */
util.longFromHash = function longFromHash(hash, unsigned) {
    var bits = util.LongBits.fromHash(hash);
    if (util.Long)
        return util.Long.fromBits(bits.lo, bits.hi, unsigned);
    return bits.toNumber(Boolean(unsigned));
};

/**
 * Merges the properties of the source object into the destination object.
 * @memberof util
 * @param {Object.<string,*>} dst Destination object
 * @param {Object.<string,*>} src Source object
 * @param {boolean} [ifNotSet=false] Merges only if the key is not already set
 * @returns {Object.<string,*>} Destination object
 */
function merge(dst, src, ifNotSet) { // used by converters
    for (var keys = Object.keys(src), i = 0; i < keys.length; ++i)
        if (dst[keys[i]] === undefined || !ifNotSet)
            dst[keys[i]] = src[keys[i]];
    return dst;
}

util.merge = merge;

/**
 * Converts the first character of a string to lower case.
 * @param {string} str String to convert
 * @returns {string} Converted string
 */
util.lcFirst = function lcFirst(str) {
    return str.charAt(0).toLowerCase() + str.substring(1);
};

/**
 * Creates a custom error constructor.
 * @memberof util
 * @param {string} name Error name
 * @returns {Constructor<Error>} Custom error constructor
 */
function newError(name) {

    function CustomError(message, properties) {

        if (!(this instanceof CustomError))
            return new CustomError(message, properties);

        // Error.call(this, message);
        // ^ just returns a new error instance because the ctor can be called as a function

        Object.defineProperty(this, "message", { get: function() { return message; } });

        /* istanbul ignore next */
        if (Error.captureStackTrace) // node
            Error.captureStackTrace(this, CustomError);
        else
            Object.defineProperty(this, "stack", { value: new Error().stack || "" });

        if (properties)
            merge(this, properties);
    }

    CustomError.prototype = Object.create(Error.prototype, {
        constructor: {
            value: CustomError,
            writable: true,
            enumerable: false,
            configurable: true,
        },
        name: {
            get: function get() { return name; },
            set: undefined,
            enumerable: false,
            // configurable: false would accurately preserve the behavior of
            // the original, but I'm guessing that was not intentional.
            // For an actual error subclass, this property would
            // be configurable.
            configurable: true,
        },
        toString: {
            value: function value() { return this.name + ": " + this.message; },
            writable: true,
            enumerable: false,
            configurable: true,
        },
    });

    return CustomError;
}

util.newError = newError;

/**
 * Constructs a new protocol error.
 * @classdesc Error subclass indicating a protocol specifc error.
 * @memberof util
 * @extends Error
 * @template T extends Message<T>
 * @constructor
 * @param {string} message Error message
 * @param {Object.<string,*>} [properties] Additional properties
 * @example
 * try {
 *     MyMessage.decode(someBuffer); // throws if required fields are missing
 * } catch (e) {
 *     if (e instanceof ProtocolError && e.instance)
 *         console.log("decoded so far: " + JSON.stringify(e.instance));
 * }
 */
util.ProtocolError = newError("ProtocolError");

/**
 * So far decoded message instance.
 * @name util.ProtocolError#instance
 * @type {Message<T>}
 */

/**
 * A OneOf getter as returned by {@link util.oneOfGetter}.
 * @typedef OneOfGetter
 * @type {function}
 * @returns {string|undefined} Set field name, if any
 */

/**
 * Builds a getter for a oneof's present field name.
 * @param {string[]} fieldNames Field names
 * @returns {OneOfGetter} Unbound getter
 */
util.oneOfGetter = function getOneOf(fieldNames) {
    var fieldMap = {};
    for (var i = 0; i < fieldNames.length; ++i)
        fieldMap[fieldNames[i]] = 1;

    /**
     * @returns {string|undefined} Set field name, if any
     * @this Object
     * @ignore
     */
    return function() { // eslint-disable-line consistent-return
        for (var keys = Object.keys(this), i = keys.length - 1; i > -1; --i)
            if (fieldMap[keys[i]] === 1 && this[keys[i]] !== undefined && this[keys[i]] !== null)
                return keys[i];
    };
};

/**
 * A OneOf setter as returned by {@link util.oneOfSetter}.
 * @typedef OneOfSetter
 * @type {function}
 * @param {string|undefined} value Field name
 * @returns {undefined}
 */

/**
 * Builds a setter for a oneof's present field name.
 * @param {string[]} fieldNames Field names
 * @returns {OneOfSetter} Unbound setter
 */
util.oneOfSetter = function setOneOf(fieldNames) {

    /**
     * @param {string} name Field name
     * @returns {undefined}
     * @this Object
     * @ignore
     */
    return function(name) {
        for (var i = 0; i < fieldNames.length; ++i)
            if (fieldNames[i] !== name)
                delete this[fieldNames[i]];
    };
};

/**
 * Default conversion options used for {@link Message#toJSON} implementations.
 *
 * These options are close to proto3's JSON mapping with the exception that internal types like Any are handled just like messages. More precisely:
 *
 * - Longs become strings
 * - Enums become string keys
 * - Bytes become base64 encoded strings
 * - (Sub-)Messages become plain objects
 * - Maps become plain objects with all string keys
 * - Repeated fields become arrays
 * - NaN and Infinity for float and double fields become strings
 *
 * @type {IConversionOptions}
 * @see https://developers.google.com/protocol-buffers/docs/proto3?hl=en#json
 */
util.toJSONOptions = {
    longs: String,
    enums: String,
    bytes: String,
    json: true
};

// Sets up buffer utility according to the environment (called in index-minimal)
util._configure = function() {
    var Buffer = util.Buffer;
    /* istanbul ignore if */
    if (!Buffer) {
        util._Buffer_from = util._Buffer_allocUnsafe = null;
        return;
    }
    // because node 4.x buffers are incompatible & immutable
    // see: https://github.com/dcodeIO/protobuf.js/pull/665
    util._Buffer_from = Buffer.from !== Uint8Array.from && Buffer.from ||
        /* istanbul ignore next */
        function Buffer_from(value, encoding) {
            return new Buffer(value, encoding);
        };
    util._Buffer_allocUnsafe = Buffer.allocUnsafe ||
        /* istanbul ignore next */
        function Buffer_allocUnsafe(size) {
            return new Buffer(size);
        };
};

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./longbits":45,"@protobufjs/aspromise":3,"@protobufjs/base64":4,"@protobufjs/eventemitter":6,"@protobufjs/float":8,"@protobufjs/inquire":9,"@protobufjs/pool":11,"@protobufjs/utf8":12}],47:[function(require,module,exports){
"use strict";
module.exports = verifier;

var Enum      = require("./enum"),
    util      = require("./util");

function invalid(field, expected) {
    return field.name + ": " + expected + (field.repeated && expected !== "array" ? "[]" : field.map && expected !== "object" ? "{k:"+field.keyType+"}" : "") + " expected";
}

/**
 * Generates a partial value verifier.
 * @param {Codegen} gen Codegen instance
 * @param {Field} field Reflected field
 * @param {number} fieldIndex Field index
 * @param {string} ref Variable reference
 * @returns {Codegen} Codegen instance
 * @ignore
 */
function genVerifyValue(gen, field, fieldIndex, ref) {
    /* eslint-disable no-unexpected-multiline */
    if (field.resolvedType) {
        if (field.resolvedType instanceof Enum) { gen
            ("switch(%s){", ref)
                ("default:")
                    ("return%j", invalid(field, "enum value"));
            for (var keys = Object.keys(field.resolvedType.values), j = 0; j < keys.length; ++j) gen
                ("case %i:", field.resolvedType.values[keys[j]]);
            gen
                    ("break")
            ("}");
        } else {
            gen
            ("{")
                ("var e=types[%i].verify(%s);", fieldIndex, ref)
                ("if(e)")
                    ("return%j+e", field.name + ".")
            ("}");
        }
    } else {
        switch (field.type) {
            case "int32":
            case "uint32":
            case "sint32":
            case "fixed32":
            case "sfixed32": gen
                ("if(!util.isInteger(%s))", ref)
                    ("return%j", invalid(field, "integer"));
                break;
            case "int64":
            case "uint64":
            case "sint64":
            case "fixed64":
            case "sfixed64": gen
                ("if(!util.isInteger(%s)&&!(%s&&util.isInteger(%s.low)&&util.isInteger(%s.high)))", ref, ref, ref, ref)
                    ("return%j", invalid(field, "integer|Long"));
                break;
            case "float":
            case "double": gen
                ("if(typeof %s!==\"number\")", ref)
                    ("return%j", invalid(field, "number"));
                break;
            case "bool": gen
                ("if(typeof %s!==\"boolean\")", ref)
                    ("return%j", invalid(field, "boolean"));
                break;
            case "string": gen
                ("if(!util.isString(%s))", ref)
                    ("return%j", invalid(field, "string"));
                break;
            case "bytes": gen
                ("if(!(%s&&typeof %s.length===\"number\"||util.isString(%s)))", ref, ref, ref)
                    ("return%j", invalid(field, "buffer"));
                break;
        }
    }
    return gen;
    /* eslint-enable no-unexpected-multiline */
}

/**
 * Generates a partial key verifier.
 * @param {Codegen} gen Codegen instance
 * @param {Field} field Reflected field
 * @param {string} ref Variable reference
 * @returns {Codegen} Codegen instance
 * @ignore
 */
function genVerifyKey(gen, field, ref) {
    /* eslint-disable no-unexpected-multiline */
    switch (field.keyType) {
        case "int32":
        case "uint32":
        case "sint32":
        case "fixed32":
        case "sfixed32": gen
            ("if(!util.key32Re.test(%s))", ref)
                ("return%j", invalid(field, "integer key"));
            break;
        case "int64":
        case "uint64":
        case "sint64":
        case "fixed64":
        case "sfixed64": gen
            ("if(!util.key64Re.test(%s))", ref) // see comment above: x is ok, d is not
                ("return%j", invalid(field, "integer|Long key"));
            break;
        case "bool": gen
            ("if(!util.key2Re.test(%s))", ref)
                ("return%j", invalid(field, "boolean key"));
            break;
    }
    return gen;
    /* eslint-enable no-unexpected-multiline */
}

/**
 * Generates a verifier specific to the specified message type.
 * @param {Type} mtype Message type
 * @returns {Codegen} Codegen instance
 */
function verifier(mtype) {
    /* eslint-disable no-unexpected-multiline */

    var gen = util.codegen(["m"], mtype.name + "$verify")
    ("if(typeof m!==\"object\"||m===null)")
        ("return%j", "object expected");
    var oneofs = mtype.oneofsArray,
        seenFirstField = {};
    if (oneofs.length) gen
    ("var p={}");

    for (var i = 0; i < /* initializes */ mtype.fieldsArray.length; ++i) {
        var field = mtype._fieldsArray[i].resolve(),
            ref   = "m" + util.safeProp(field.name);

        if (field.optional) gen
        ("if(%s!=null&&m.hasOwnProperty(%j)){", ref, field.name); // !== undefined && !== null

        // map fields
        if (field.map) { gen
            ("if(!util.isObject(%s))", ref)
                ("return%j", invalid(field, "object"))
            ("var k=Object.keys(%s)", ref)
            ("for(var i=0;i<k.length;++i){");
                genVerifyKey(gen, field, "k[i]");
                genVerifyValue(gen, field, i, ref + "[k[i]]")
            ("}");

        // repeated fields
        } else if (field.repeated) { gen
            ("if(!Array.isArray(%s))", ref)
                ("return%j", invalid(field, "array"))
            ("for(var i=0;i<%s.length;++i){", ref);
                genVerifyValue(gen, field, i, ref + "[i]")
            ("}");

        // required or present fields
        } else {
            if (field.partOf) {
                var oneofProp = util.safeProp(field.partOf.name);
                if (seenFirstField[field.partOf.name] === 1) gen
            ("if(p%s===1)", oneofProp)
                ("return%j", field.partOf.name + ": multiple values");
                seenFirstField[field.partOf.name] = 1;
                gen
            ("p%s=1", oneofProp);
            }
            genVerifyValue(gen, field, i, ref);
        }
        if (field.optional) gen
        ("}");
    }
    return gen
    ("return null");
    /* eslint-enable no-unexpected-multiline */
}
},{"./enum":22,"./util":44}],48:[function(require,module,exports){
"use strict";

/**
 * Wrappers for common types.
 * @type {Object.<string,IWrapper>}
 * @const
 */
var wrappers = exports;

var Message = require("./message");

/**
 * From object converter part of an {@link IWrapper}.
 * @typedef WrapperFromObjectConverter
 * @type {function}
 * @param {Object.<string,*>} object Plain object
 * @returns {Message<{}>} Message instance
 * @this Type
 */

/**
 * To object converter part of an {@link IWrapper}.
 * @typedef WrapperToObjectConverter
 * @type {function}
 * @param {Message<{}>} message Message instance
 * @param {IConversionOptions} [options] Conversion options
 * @returns {Object.<string,*>} Plain object
 * @this Type
 */

/**
 * Common type wrapper part of {@link wrappers}.
 * @interface IWrapper
 * @property {WrapperFromObjectConverter} [fromObject] From object converter
 * @property {WrapperToObjectConverter} [toObject] To object converter
 */

// Custom wrapper for Any
wrappers[".google.protobuf.Any"] = {

    fromObject: function(object) {

        // unwrap value type if mapped
        if (object && object["@type"]) {
             // Only use fully qualified type name after the last '/'
            var name = object["@type"].substring(object["@type"].lastIndexOf("/") + 1);
            var type = this.lookup(name);
            /* istanbul ignore else */
            if (type) {
                // type_url does not accept leading "."
                var type_url = object["@type"].charAt(0) === "." ?
                    object["@type"].slice(1) : object["@type"];
                // type_url prefix is optional, but path seperator is required
                if (type_url.indexOf("/") === -1) {
                    type_url = "/" + type_url;
                }
                return this.create({
                    type_url: type_url,
                    value: type.encode(type.fromObject(object)).finish()
                });
            }
        }

        return this.fromObject(object);
    },

    toObject: function(message, options) {

        // Default prefix
        var googleApi = "type.googleapis.com/";
        var prefix = "";
        var name = "";

        // decode value if requested and unmapped
        if (options && options.json && message.type_url && message.value) {
            // Only use fully qualified type name after the last '/'
            name = message.type_url.substring(message.type_url.lastIndexOf("/") + 1);
            // Separate the prefix used
            prefix = message.type_url.substring(0, message.type_url.lastIndexOf("/") + 1);
            var type = this.lookup(name);
            /* istanbul ignore else */
            if (type)
                message = type.decode(message.value);
        }

        // wrap value if unmapped
        if (!(message instanceof this.ctor) && message instanceof Message) {
            var object = message.$type.toObject(message, options);
            var messageName = message.$type.fullName[0] === "." ?
                message.$type.fullName.slice(1) : message.$type.fullName;
            // Default to type.googleapis.com prefix if no prefix is used
            if (prefix === "") {
                prefix = googleApi;
            }
            name = prefix + messageName;
            object["@type"] = name;
            return object;
        }

        return this.toObject(message, options);
    }
};

},{"./message":28}],49:[function(require,module,exports){
"use strict";
module.exports = Writer;

var util      = require("./util/minimal");

var BufferWriter; // cyclic

var LongBits  = util.LongBits,
    base64    = util.base64,
    utf8      = util.utf8;

/**
 * Constructs a new writer operation instance.
 * @classdesc Scheduled writer operation.
 * @constructor
 * @param {function(*, Uint8Array, number)} fn Function to call
 * @param {number} len Value byte length
 * @param {*} val Value to write
 * @ignore
 */
function Op(fn, len, val) {

    /**
     * Function to call.
     * @type {function(Uint8Array, number, *)}
     */
    this.fn = fn;

    /**
     * Value byte length.
     * @type {number}
     */
    this.len = len;

    /**
     * Next operation.
     * @type {Writer.Op|undefined}
     */
    this.next = undefined;

    /**
     * Value to write.
     * @type {*}
     */
    this.val = val; // type varies
}

/* istanbul ignore next */
function noop() {} // eslint-disable-line no-empty-function

/**
 * Constructs a new writer state instance.
 * @classdesc Copied writer state.
 * @memberof Writer
 * @constructor
 * @param {Writer} writer Writer to copy state from
 * @ignore
 */
function State(writer) {

    /**
     * Current head.
     * @type {Writer.Op}
     */
    this.head = writer.head;

    /**
     * Current tail.
     * @type {Writer.Op}
     */
    this.tail = writer.tail;

    /**
     * Current buffer length.
     * @type {number}
     */
    this.len = writer.len;

    /**
     * Next state.
     * @type {State|null}
     */
    this.next = writer.states;
}

/**
 * Constructs a new writer instance.
 * @classdesc Wire format writer using `Uint8Array` if available, otherwise `Array`.
 * @constructor
 */
function Writer() {

    /**
     * Current length.
     * @type {number}
     */
    this.len = 0;

    /**
     * Operations head.
     * @type {Object}
     */
    this.head = new Op(noop, 0, 0);

    /**
     * Operations tail
     * @type {Object}
     */
    this.tail = this.head;

    /**
     * Linked forked states.
     * @type {Object|null}
     */
    this.states = null;

    // When a value is written, the writer calculates its byte length and puts it into a linked
    // list of operations to perform when finish() is called. This both allows us to allocate
    // buffers of the exact required size and reduces the amount of work we have to do compared
    // to first calculating over objects and then encoding over objects. In our case, the encoding
    // part is just a linked list walk calling operations with already prepared values.
}

var create = function create() {
    return util.Buffer
        ? function create_buffer_setup() {
            return (Writer.create = function create_buffer() {
                return new BufferWriter();
            })();
        }
        /* istanbul ignore next */
        : function create_array() {
            return new Writer();
        };
};

/**
 * Creates a new writer.
 * @function
 * @returns {BufferWriter|Writer} A {@link BufferWriter} when Buffers are supported, otherwise a {@link Writer}
 */
Writer.create = create();

/**
 * Allocates a buffer of the specified size.
 * @param {number} size Buffer size
 * @returns {Uint8Array} Buffer
 */
Writer.alloc = function alloc(size) {
    return new util.Array(size);
};

// Use Uint8Array buffer pool in the browser, just like node does with buffers
/* istanbul ignore else */
if (util.Array !== Array)
    Writer.alloc = util.pool(Writer.alloc, util.Array.prototype.subarray);

/**
 * Pushes a new operation to the queue.
 * @param {function(Uint8Array, number, *)} fn Function to call
 * @param {number} len Value byte length
 * @param {number} val Value to write
 * @returns {Writer} `this`
 * @private
 */
Writer.prototype._push = function push(fn, len, val) {
    this.tail = this.tail.next = new Op(fn, len, val);
    this.len += len;
    return this;
};

function writeByte(val, buf, pos) {
    buf[pos] = val & 255;
}

function writeVarint32(val, buf, pos) {
    while (val > 127) {
        buf[pos++] = val & 127 | 128;
        val >>>= 7;
    }
    buf[pos] = val;
}

/**
 * Constructs a new varint writer operation instance.
 * @classdesc Scheduled varint writer operation.
 * @extends Op
 * @constructor
 * @param {number} len Value byte length
 * @param {number} val Value to write
 * @ignore
 */
function VarintOp(len, val) {
    this.len = len;
    this.next = undefined;
    this.val = val;
}

VarintOp.prototype = Object.create(Op.prototype);
VarintOp.prototype.fn = writeVarint32;

/**
 * Writes an unsigned 32 bit value as a varint.
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.uint32 = function write_uint32(value) {
    // here, the call to this.push has been inlined and a varint specific Op subclass is used.
    // uint32 is by far the most frequently used operation and benefits significantly from this.
    this.len += (this.tail = this.tail.next = new VarintOp(
        (value = value >>> 0)
                < 128       ? 1
        : value < 16384     ? 2
        : value < 2097152   ? 3
        : value < 268435456 ? 4
        :                     5,
    value)).len;
    return this;
};

/**
 * Writes a signed 32 bit value as a varint.
 * @function
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.int32 = function write_int32(value) {
    return value < 0
        ? this._push(writeVarint64, 10, LongBits.fromNumber(value)) // 10 bytes per spec
        : this.uint32(value);
};

/**
 * Writes a 32 bit value as a varint, zig-zag encoded.
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.sint32 = function write_sint32(value) {
    return this.uint32((value << 1 ^ value >> 31) >>> 0);
};

function writeVarint64(val, buf, pos) {
    while (val.hi) {
        buf[pos++] = val.lo & 127 | 128;
        val.lo = (val.lo >>> 7 | val.hi << 25) >>> 0;
        val.hi >>>= 7;
    }
    while (val.lo > 127) {
        buf[pos++] = val.lo & 127 | 128;
        val.lo = val.lo >>> 7;
    }
    buf[pos++] = val.lo;
}

/**
 * Writes an unsigned 64 bit value as a varint.
 * @param {Long|number|string} value Value to write
 * @returns {Writer} `this`
 * @throws {TypeError} If `value` is a string and no long library is present.
 */
Writer.prototype.uint64 = function write_uint64(value) {
    var bits = LongBits.from(value);
    return this._push(writeVarint64, bits.length(), bits);
};

/**
 * Writes a signed 64 bit value as a varint.
 * @function
 * @param {Long|number|string} value Value to write
 * @returns {Writer} `this`
 * @throws {TypeError} If `value` is a string and no long library is present.
 */
Writer.prototype.int64 = Writer.prototype.uint64;

/**
 * Writes a signed 64 bit value as a varint, zig-zag encoded.
 * @param {Long|number|string} value Value to write
 * @returns {Writer} `this`
 * @throws {TypeError} If `value` is a string and no long library is present.
 */
Writer.prototype.sint64 = function write_sint64(value) {
    var bits = LongBits.from(value).zzEncode();
    return this._push(writeVarint64, bits.length(), bits);
};

/**
 * Writes a boolish value as a varint.
 * @param {boolean} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.bool = function write_bool(value) {
    return this._push(writeByte, 1, value ? 1 : 0);
};

function writeFixed32(val, buf, pos) {
    buf[pos    ] =  val         & 255;
    buf[pos + 1] =  val >>> 8   & 255;
    buf[pos + 2] =  val >>> 16  & 255;
    buf[pos + 3] =  val >>> 24;
}

/**
 * Writes an unsigned 32 bit value as fixed 32 bits.
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.fixed32 = function write_fixed32(value) {
    return this._push(writeFixed32, 4, value >>> 0);
};

/**
 * Writes a signed 32 bit value as fixed 32 bits.
 * @function
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.sfixed32 = Writer.prototype.fixed32;

/**
 * Writes an unsigned 64 bit value as fixed 64 bits.
 * @param {Long|number|string} value Value to write
 * @returns {Writer} `this`
 * @throws {TypeError} If `value` is a string and no long library is present.
 */
Writer.prototype.fixed64 = function write_fixed64(value) {
    var bits = LongBits.from(value);
    return this._push(writeFixed32, 4, bits.lo)._push(writeFixed32, 4, bits.hi);
};

/**
 * Writes a signed 64 bit value as fixed 64 bits.
 * @function
 * @param {Long|number|string} value Value to write
 * @returns {Writer} `this`
 * @throws {TypeError} If `value` is a string and no long library is present.
 */
Writer.prototype.sfixed64 = Writer.prototype.fixed64;

/**
 * Writes a float (32 bit).
 * @function
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.float = function write_float(value) {
    return this._push(util.float.writeFloatLE, 4, value);
};

/**
 * Writes a double (64 bit float).
 * @function
 * @param {number} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.double = function write_double(value) {
    return this._push(util.float.writeDoubleLE, 8, value);
};

var writeBytes = util.Array.prototype.set
    ? function writeBytes_set(val, buf, pos) {
        buf.set(val, pos); // also works for plain array values
    }
    /* istanbul ignore next */
    : function writeBytes_for(val, buf, pos) {
        for (var i = 0; i < val.length; ++i)
            buf[pos + i] = val[i];
    };

/**
 * Writes a sequence of bytes.
 * @param {Uint8Array|string} value Buffer or base64 encoded string to write
 * @returns {Writer} `this`
 */
Writer.prototype.bytes = function write_bytes(value) {
    var len = value.length >>> 0;
    if (!len)
        return this._push(writeByte, 1, 0);
    if (util.isString(value)) {
        var buf = Writer.alloc(len = base64.length(value));
        base64.decode(value, buf, 0);
        value = buf;
    }
    return this.uint32(len)._push(writeBytes, len, value);
};

/**
 * Writes a string.
 * @param {string} value Value to write
 * @returns {Writer} `this`
 */
Writer.prototype.string = function write_string(value) {
    var len = utf8.length(value);
    return len
        ? this.uint32(len)._push(utf8.write, len, value)
        : this._push(writeByte, 1, 0);
};

/**
 * Forks this writer's state by pushing it to a stack.
 * Calling {@link Writer#reset|reset} or {@link Writer#ldelim|ldelim} resets the writer to the previous state.
 * @returns {Writer} `this`
 */
Writer.prototype.fork = function fork() {
    this.states = new State(this);
    this.head = this.tail = new Op(noop, 0, 0);
    this.len = 0;
    return this;
};

/**
 * Resets this instance to the last state.
 * @returns {Writer} `this`
 */
Writer.prototype.reset = function reset() {
    if (this.states) {
        this.head   = this.states.head;
        this.tail   = this.states.tail;
        this.len    = this.states.len;
        this.states = this.states.next;
    } else {
        this.head = this.tail = new Op(noop, 0, 0);
        this.len  = 0;
    }
    return this;
};

/**
 * Resets to the last state and appends the fork state's current write length as a varint followed by its operations.
 * @returns {Writer} `this`
 */
Writer.prototype.ldelim = function ldelim() {
    var head = this.head,
        tail = this.tail,
        len  = this.len;
    this.reset().uint32(len);
    if (len) {
        this.tail.next = head.next; // skip noop
        this.tail = tail;
        this.len += len;
    }
    return this;
};

/**
 * Finishes the write operation.
 * @returns {Uint8Array} Finished buffer
 */
Writer.prototype.finish = function finish() {
    var head = this.head.next, // skip noop
        buf  = this.constructor.alloc(this.len),
        pos  = 0;
    while (head) {
        head.fn(head.val, buf, pos);
        pos += head.len;
        head = head.next;
    }
    // this.head = this.tail = null;
    return buf;
};

Writer._configure = function(BufferWriter_) {
    BufferWriter = BufferWriter_;
    Writer.create = create();
    BufferWriter._configure();
};

},{"./util/minimal":46}],50:[function(require,module,exports){
"use strict";
module.exports = BufferWriter;

// extends Writer
var Writer = require("./writer");
(BufferWriter.prototype = Object.create(Writer.prototype)).constructor = BufferWriter;

var util = require("./util/minimal");

/**
 * Constructs a new buffer writer instance.
 * @classdesc Wire format writer using node buffers.
 * @extends Writer
 * @constructor
 */
function BufferWriter() {
    Writer.call(this);
}

BufferWriter._configure = function () {
    /**
     * Allocates a buffer of the specified size.
     * @function
     * @param {number} size Buffer size
     * @returns {Buffer} Buffer
     */
    BufferWriter.alloc = util._Buffer_allocUnsafe;

    BufferWriter.writeBytesBuffer = util.Buffer && util.Buffer.prototype instanceof Uint8Array && util.Buffer.prototype.set.name === "set"
        ? function writeBytesBuffer_set(val, buf, pos) {
          buf.set(val, pos); // faster than copy (requires node >= 4 where Buffers extend Uint8Array and set is properly inherited)
          // also works for plain array values
        }
        /* istanbul ignore next */
        : function writeBytesBuffer_copy(val, buf, pos) {
          if (val.copy) // Buffer values
            val.copy(buf, pos, 0, val.length);
          else for (var i = 0; i < val.length;) // plain array values
            buf[pos++] = val[i++];
        };
};


/**
 * @override
 */
BufferWriter.prototype.bytes = function write_bytes_buffer(value) {
    if (util.isString(value))
        value = util._Buffer_from(value, "base64");
    var len = value.length >>> 0;
    this.uint32(len);
    if (len)
        this._push(BufferWriter.writeBytesBuffer, len, value);
    return this;
};

function writeStringBuffer(val, buf, pos) {
    if (val.length < 40) // plain js is faster for short strings (probably due to redundant assertions)
        util.utf8.write(val, buf, pos);
    else if (buf.utf8Write)
        buf.utf8Write(val, pos);
    else
        buf.write(val, pos);
}

/**
 * @override
 */
BufferWriter.prototype.string = function write_string_buffer(value) {
    var len = util.Buffer.byteLength(value);
    this.uint32(len);
    if (len)
        this._push(writeStringBuffer, len, value);
    return this;
};


/**
 * Finishes the write operation.
 * @name BufferWriter#finish
 * @function
 * @returns {Buffer} Finished buffer
 */

BufferWriter._configure();

},{"./util/minimal":46,"./writer":49}],51:[function(require,module,exports){
(function (setImmediate,clearImmediate){(function (){
var nextTick = require('process/browser.js').nextTick;
var apply = Function.prototype.apply;
var slice = Array.prototype.slice;
var immediateIds = {};
var nextImmediateId = 0;

// DOM APIs, for completeness

exports.setTimeout = function() {
  return new Timeout(apply.call(setTimeout, window, arguments), clearTimeout);
};
exports.setInterval = function() {
  return new Timeout(apply.call(setInterval, window, arguments), clearInterval);
};
exports.clearTimeout =
exports.clearInterval = function(timeout) { timeout.close(); };

function Timeout(id, clearFn) {
  this._id = id;
  this._clearFn = clearFn;
}
Timeout.prototype.unref = Timeout.prototype.ref = function() {};
Timeout.prototype.close = function() {
  this._clearFn.call(window, this._id);
};

// Does not start the time, just sets up the members needed.
exports.enroll = function(item, msecs) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = msecs;
};

exports.unenroll = function(item) {
  clearTimeout(item._idleTimeoutId);
  item._idleTimeout = -1;
};

exports._unrefActive = exports.active = function(item) {
  clearTimeout(item._idleTimeoutId);

  var msecs = item._idleTimeout;
  if (msecs >= 0) {
    item._idleTimeoutId = setTimeout(function onTimeout() {
      if (item._onTimeout)
        item._onTimeout();
    }, msecs);
  }
};

// That's not how node.js implements it but the exposed api is the same.
exports.setImmediate = typeof setImmediate === "function" ? setImmediate : function(fn) {
  var id = nextImmediateId++;
  var args = arguments.length < 2 ? false : slice.call(arguments, 1);

  immediateIds[id] = true;

  nextTick(function onNextTick() {
    if (immediateIds[id]) {
      // fn.call() is faster so we optimize for the common use-case
      // @see http://jsperf.com/call-apply-segu
      if (args) {
        fn.apply(null, args);
      } else {
        fn.call(null);
      }
      // Prevent ids from leaking
      exports.clearImmediate(id);
    }
  });

  return id;
};

exports.clearImmediate = typeof clearImmediate === "function" ? clearImmediate : function(id) {
  delete immediateIds[id];
};
}).call(this)}).call(this,require("timers").setImmediate,require("timers").clearImmediate)
},{"process/browser.js":16,"timers":51}],52:[function(require,module,exports){
'use strict';

module.exports = function () {
  throw new Error(
    'ws does not work in the browser. Browser clients must use the native ' +
      'WebSocket object'
  );
};

},{}],53:[function(require,module,exports){
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

},{"@liamcottle/rustplus.js":2}]},{},[53]);
