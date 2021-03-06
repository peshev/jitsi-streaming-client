import JitsiMeetJS from 'lib-jitsi-meet'
import $ from 'jquery'
import './style.css';
import SwitchCameraImage from './switch-camera.svg';

const options = {
    hosts: {
        domain: 'meet.jitsi',
        muc: 'muc.meet.jitsi'
    },
    serviceUrl: `wss://${window.location.host}/xmpp-websocket`
};

const confOptions = {};

let connection = null;
let isJoined = false;
let room = null;

let localTracks = [];
const remoteTracks = {};

const MODE_STREAM = "stream";
const MODE_WATCH = "watch";
const MODES = [MODE_STREAM, MODE_WATCH];

const TRACK_TYPE_AUDIO = "audio";
const TRACK_TYPE_VIDEO = "video";
const TRACK_TYPES = [TRACK_TYPE_AUDIO, TRACK_TYPE_VIDEO];

function log_message(message) {
    return `[JSC][${Date.now()}]${message}`;
}

function log(message) {
    console.log(log_message(` ${message}`))
}

function error(message) {
    console.error(log_message(` ${message}`));
}

function track_log_message(track, message) {
    return log_message(`[${track.getType()}][${getTrackId(track)}] ${message}`);
}

function log_track(track, message) {
    console.log(track_log_message(track, message));
}

function error_track(track, message) {
    console.error(track_log_message(track, message));
}

function addTrackInfoListeners(side, track) {
    track.addEventListener(JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED,
        audioLevel => log_track(track, `${side} track changed audio level to ${audioLevel}`));
    track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED,
        () => log_track(track, `${side} track has been muted`));
    track.addEventListener(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED,
        () => log_track(track, `${side} track has been stopped`));
    track.addEventListener(JitsiMeetJS.events.track.TRACK_AUDIO_OUTPUT_CHANGED,
        deviceId => log_track(track, `${side} track changed output device to ${deviceId}`));
}

function addConferenceInfoListeners(room) {
    room.on(JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED,
        (participantId, displayName) => log(`Participant ${participantId} changed their display name to ${displayName}`));
    room.on(JitsiMeetJS.events.conference.PHONE_NUMBER_CHANGED,
        () => log(`The room phone number changed to ${room.getPhoneNumber()} (PIN: ${room.getPhonePin()})`));
}

function getTracksArray(track) {
    return track.getParticipantId() ? remoteTracks[track.getParticipantId()] : localTracks;
}

function getTrackId(track) {
    // let participant = track.getParticipantId() ? track.getParticipantId() : 'local'
    // return `${participant}-${track.getType()}-${track.getTrackId().replaceAll('{', '').replaceAll('}', '')}`;
    return track.getTrackId();
}

function attachTrack(track) {
    getTracksArray(track).push(track);

    const trackElement = document.createElement(track.getType());
    trackElement.id = getTrackId(track);
    trackElement.autoplay = 1;
    $('body').append(trackElement);

    track.attach(trackElement);

    return trackElement;
}

function removeTrack(track) {
    const trackElement = document.getElementById(getTrackId(track));
    try {
        track.detach(trackElement);
    } catch (e) {
        error(e);
    }
    trackElement.remove();
}

function removeArrayElement(array, value) {
    return array.filter(t => t !== value);
}

function onLocalTrackAdded(track) {
    log_track(track, `Adding local track`);

    if (TRACK_TYPES.includes(track.getType())) {
        addTrackInfoListeners("Local", track);

        const trackElement = attachTrack(track);

        if (track.getType() === TRACK_TYPE_AUDIO) {
            trackElement.muted = true;
        } else if (track.getType() === TRACK_TYPE_VIDEO) {
            trackElement.style.width = '100%'
            trackElement.style.height = '100%'
            trackElement.playsInline = true;
        }

        if (isJoined) {
            room.addTrack(track);
            log_track(track, `Added new track post joining room ${room.getMeetingUniqueId()}`)
        }
    } else {
        error_track(track, `Unexpected local track type ${track.getType()}`);
    }
}

function removeLocalTrack(track) {
    log_track(track, `Removing local track`);
    removeTrack(track);
    if (isJoined) {
        room.removeTrack(track);
        log_track(track, `Removed local track from room ${room.getMeetingUniqueId()}`);
    }
}

function onRemoteTrackAdded(track) {
    const participant = track.getParticipantId();
    log_track(track, `Adding remote track by participant ${participant} in room ${room.getMeetingUniqueId()}`);

    if (!TRACK_TYPES.includes(track.getType())) {
        throw track_log_message(track, `Unexpected remote track type ${track.getType()} for participant ${participant}}`)
    }

    if (!remoteTracks[participant]) {
        remoteTracks[participant] = [];
    }

    addTrackInfoListeners(`Remote participant ${participant}`, track);

    const trackElement = attachTrack(track);

    // if (track.getType() === TRACK_TYPE_VIDEO) {
    //     trackElement.style.height = '640px';
    //     trackElement.style.width = '352px';
    // }
}

function onRemoteTrackRemoved(track) {
    const participant = track.getParticipantId();
    log_track(track, `Removing remote track by participant ${participant} in room ${room.getMeetingUniqueId()}`);
    removeTrack(track);
    const tracks = remoteTracks[participant]
    if (tracks) {
        remoteTracks[participant] = removeArrayElement(tracks, track);
    }
}

function onConferenceJoined() {
    log(`Joined room ${room.getMeetingUniqueId()}`);
    isJoined = true;
    for (let i = 0; i < localTracks.length; i++) {
        const track = localTracks[i];
        room.addTrack(track);
        log_track(track, `Added existing track upon joining room ${room.getMeetingUniqueId()}`)
    }
}

function onConferenceLeft() {
    log(`Left room ${room.getMeetingUniqueId()}`);
    isJoined = false;
}

function onUserJoined(id) {
    log(`User ${id} has joined room ${room.getMeetingUniqueId()}`);
    remoteTracks[id] = [];
}

function onUserLeft(id) {
    log(`User ${id} has left room ${room.getMeetingUniqueId()}`);
    if (!remoteTracks[id]) {
        return;
    }
    remoteTracks[id].forEach(removeTrack);
    delete remoteTracks[id];
}

function onConnectionEstablished() {
    log('Connection has been established successfully');

    room = connection.initJitsiConference(params.id || 'conference', confOptions);

    if (params.mode === MODE_STREAM) {
        room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED,
            onConferenceJoined);
        room.on(JitsiMeetJS.events.conference.CONFERENCE_LEFT,
            onConferenceLeft);
    }

    if (params.mode === MODE_WATCH) {
        room.on(JitsiMeetJS.events.conference.TRACK_ADDED,
            onRemoteTrackAdded);
        room.on(JitsiMeetJS.events.conference.TRACK_REMOVED,
            onRemoteTrackRemoved);
        room.on(JitsiMeetJS.events.conference.USER_JOINED,
            onUserJoined);
        room.on(JitsiMeetJS.events.conference.USER_LEFT,
            onUserLeft);
    }

    addConferenceInfoListeners(room);

    room.join();
}

function onConnectionFailed() {
    error('Connection failed');
}

function onConnectionDisconnected() {
    log('Connection has been disconnected');
    removeConnectionListeners(connection)
}

function disconnect() {
    for (let i = 0; i < localTracks.length; i++) {
        localTracks[i].dispose();
    }
    room.leave();
    connection.disconnect();
}

function populateAudioOutputSelector(devices) {
    const audioOutputDevices = devices.filter(d => d.kind === 'audiooutput');
    const currentAudioOutputDevice = JitsiMeetJS.mediaDevices.getAudioOutputDevice();
    if (audioOutputDevices.length > 1) {
        const wrapper = $('#audioOutputSelectWrapper');
        wrapper.html(
            '<label for="audioOutputSelect">Change audio output device</label>' +
            audioOutputDevices
                .map(d => `<option value="${d.deviceId}" ${d === currentAudioOutputDevice ? 'selected="selected"' : ''}>${d.label}</option>`)
                .join('') +
            '<select id="audioOutputSelect" onChange="changeAudioOutput(this)">' +
            '</select>');
        wrapper.show();
    }
}

function changeAudioOutput(selected) {
    JitsiMeetJS.mediaDevices.setAudioOutputDevice(selected.value);
}

const connectionListeners = [
    [JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, onConnectionEstablished],
    [JitsiMeetJS.events.connection.CONNECTION_FAILED, onConnectionFailed],
    [JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, onConnectionDisconnected],
]

function addConnectionListeners() {
    connectionListeners.forEach(([e, t]) => connection.addEventListener(e, t))
}

function removeConnectionListeners() {
    connectionListeners.forEach(([e, t]) => connection.removeEventListener(e, t))
}

function parseQueryString() {
    return window.location.search.substring(1)
        .split('&')
        .map(i => i.split('=', 2))
        .reduce((a, [n, v]) => {
            a[n] = v;
            return a
        }, {})
}

function playRemoteTracks() {
    Object.entries(remoteTracks)
        .forEach(([participant, tracks]) => tracks
            .forEach(track => $(`#${getTrackId(track)}`)[0].play()));
}

const params = parseQueryString();
if (!MODES.includes(params.mode)) {
    throw `Invalid mode ${params.mode}`
}

let facingUser = false;

function createLocalTracks() {
    JitsiMeetJS.createLocalTracks({
        devices: ['audio', 'video'],
        facingMode: facingUser ? "user" : "environment",
        constraints: {
            width: {min: 640, ideal: 1280, max: 1920},
            height: {min: 480, ideal: 720, max: 1080},
            frameRate: {min: 10, ideal: 24, max: 60},
        },
        minFps: 10,
        maxFps: 60,
    }).then(tracks => tracks.forEach(onLocalTrackAdded));

}

function switchCamera() {
    facingUser = !facingUser;
    localTracks.forEach(removeLocalTrack);
    localTracks = [];
    createLocalTracks();
}

$(window).bind('beforeunload', disconnect);
$(window).bind('unload', disconnect);

// JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);

const initOptions = {
    disableAudioLevels: true
};

$(function () {
    const body = $('body');
    JitsiMeetJS.init(initOptions);

    connection = new JitsiMeetJS.JitsiConnection(null, null, options);
    addConnectionListeners(connectionListeners);
    connection.connect();

    if (params.mode === MODE_STREAM) {
        createLocalTracks();
        if (JitsiMeetJS.mediaDevices.isDeviceChangeAvailable('output')) {
            JitsiMeetJS.mediaDevices.enumerateDevices().then(populateAudioOutputSelector);
            JitsiMeetJS.mediaDevices.addEventListener(JitsiMeetJS.events.mediaDevices.DEVICE_LIST_CHANGED,
                populateAudioOutputSelector);
        }
        const switchCameraButton = document.createElement("img");
        switchCameraButton.id = "switch-camera";
        switchCameraButton.src = SwitchCameraImage;
        switchCameraButton.alt = "CR";
        switchCameraButton.onclick = switchCamera;
        body.append(switchCameraButton);
    } else if (params.mode === MODE_WATCH) {
        const audioOutputSelect = document.createElement("div");
        audioOutputSelect.id = "audioOutputSelectWrapper";
        audioOutputSelect.style.display = 'none';
        body.append(audioOutputSelect);

        const startButton = document.createElement("a");
        startButton.id = "start";
        startButton.onclick = playRemoteTracks;
        startButton.innerText = "Start";
        startButton.style.color = "white";
        body.append(startButton);

        body.append('<br/>');
    }
});
