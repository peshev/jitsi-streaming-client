import JitsiMeetJS from 'lib-jitsi-meet'
import $ from 'jquery'

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

function addTrackInfoListeners(side, track) {
    track.addEventListener(JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED,
        audioLevel => console.log(`${side} ${track.getType()} track changed audio level to ${audioLevel}`));
    track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED,
        () => console.log(`${side} ${track.getType()} track has been muted`));
    track.addEventListener(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED,
        () => console.log(`${side} ${track.getType()} track has been stopped`));
    track.addEventListener(JitsiMeetJS.events.track.TRACK_AUDIO_OUTPUT_CHANGED,
        deviceId => console.log(`${side} ${track.getType()} track changed output device to ${deviceId}`));
}

function addConferenceInfoListeners(room) {
    room.on(JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED,
        (participantId, displayName) => console.log(`Participant ${participantId} changed their display name to ${displayName}`));
    room.on(JitsiMeetJS.events.conference.PHONE_NUMBER_CHANGED,
        () => console.log(`The room phone number changed to ${room.getPhoneNumber()} (PIN: ${room.getPhonePin()})`));
}

function onLocalTracksCreated(tracks) {
    for (let i = 0; i < tracks.length; i++) {
        let track = tracks[i];

        if (!track.isLocal()) {
            continue;
        }
        if (track.getType() === 'video') {
            $('body').append(`<video autoplay='autoplay' id='localVideo${i}' />`);
            track.attach($(`#localVideo${i}`)[0]);
        } else if (track.getType() === 'audio') {
            $('body').append(`<audio autoplay='autoplay' muted='muted' id='localAudio${i}' />`);
            track.attach($(`#localAudio${i}`)[0]);
        } else {
            console.error(`Unknown track type ${track.getType()}`)
            continue;
        }

        addTrackInfoListeners("Local", track);

        if (isJoined) {
            room.addTrack(track);
        }
    }
}

function getRemoteTrackId(track) {
    const participant = track.getParticipantId();
    return participant + track.getType() + remoteTracks[participant].indexOf(track);
}

function onRemoteTrackAdded(track) {
    console.log(`User ${track.getParticipantId()} has added a ${track.getType()} track`);
    const participant = track.getParticipantId();

    if(!TRACK_TYPES.includes(track.getType())) {
        throw `Unexpected remote track type ${track.getType} for participant ${participant}`
    }

    if (!remoteTracks[participant]) {
        remoteTracks[participant] = [];
    }
    remoteTracks[participant].push(track);

    addTrackInfoListeners(`Remote participant ${participant}`, track);

    const id = getRemoteTrackId(track);
    $('body').append(`<${track.getType()} autoplay='1' id='${id}' />`);
    track.attach($(`#${id}`)[0]);
}


function onRemoteTrackRemoved(track) {
    console.log(`User ${track.getParticipantId()} has removed a ${track.getType()} track`);
    removeRemoteTrack(track);
    const tracks = remoteTracks[track.getParticipantId()]
    if (tracks) {
        remoteTracks[track.getParticipantId()] = tracks.filter(t => t !== track)
    }
}

function removeRemoteTrack(track) {
    const element = $(`#${getRemoteTrackId(track)}`)
    try {
        track.detach(element);
    } catch (e) {
        console.error(e);
    }
    element.remove();
}

function onConferenceJoined() {
    console.log('We have joined the conference');
    isJoined = true;
    for (let i = 0; i < localTracks.length; i++) {
        room.addTrack(localTracks[i]);
    }
}

function onConferenceLeft() {
    console.log('We have left the conference');
    isJoined = false;
}

function onUserJoined(id) {
    console.log(`User ${id} has joined the conference`);
    remoteTracks[id] = [];
}

function onUserLeft(id) {
    console.log(`User ${id} has left the conference`);
    if (!remoteTracks[id]) {
        return;
    }
    remoteTracks[id].forEach(removeRemoteTrack);
    delete remoteTracks[id];
}

function onConnectionEstablished() {
    console.log('Connection has been established successfully');

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
    console.error('Connection failed');
}

function onConnectionDisconnected() {
    console.log('Connection has been disconnected');
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

const params = parseQueryString();
if (!MODES.includes(params.mode)) {
    throw `Invalid mode ${params.mode}`
}

$(window).bind('beforeunload', disconnect);
$(window).bind('unload', disconnect);
$('body').append('<div id="audioOutputSelectWrapper" style="display: none;"/>')
// JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
const initOptions = {
    disableAudioLevels: true
};

JitsiMeetJS.init(initOptions);

connection = new JitsiMeetJS.JitsiConnection(null, null, options);
addConnectionListeners(connectionListeners);
connection.connect();

if (params.mode === MODE_STREAM) {
    JitsiMeetJS.createLocalTracks({devices: ['audio', 'video']}).then(onLocalTracksCreated);
    if (JitsiMeetJS.mediaDevices.isDeviceChangeAvailable('output')) {
        JitsiMeetJS.mediaDevices.enumerateDevices().then(populateAudioOutputSelector);
        JitsiMeetJS.mediaDevices.addEventListener(JitsiMeetJS.events.mediaDevices.DEVICE_LIST_CHANGED,
            populateAudioOutputSelector);
    }
}
