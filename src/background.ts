import Reason = chrome.offscreen.Reason;
import ContextType = chrome.runtime.ContextType;

const CONFIG = {
    AUDIO_ACTIVE: "audioActive",
    SHOW_NOTIFICATION: "showNotification",
    OPEN_PROLIFIC: "openProlific",
    AUDIO: "audio",
    VOLUME: "volume",
    COUNTER: "counter",
    ICON_URL: 'imgs/logo.png',
    TITLE: 'Prolific Automatic Studies',
    MESSAGE: 'A new study has been posted on Prolific!',
    PROLIFIC_TITLE: 'prolificTitle',
    PROLIFIC_URL: "https://app.prolific.com/",
    WELCOME_URL: "https://spin311.github.io/ProlificAutomaticStudies/"
};

let creating: Promise<void> | null; // A global promise to avoid concurrency issues
let volume: number;
let audio: string;
let shouldSendNotification: boolean;
let shouldPlayAudio: boolean;
let previousTitle: string;

// Event listeners
chrome.runtime.onMessage.addListener(handleMessages);
chrome.notifications.onClicked.addListener(handleNotificationClick);
chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClick);
chrome.runtime.onInstalled.addListener(handleInstallation);
chrome.runtime.onStartup.addListener(openProlificOnStartup);
chrome.tabs.onUpdated.addListener(handleTabUpdate);

// Event handler functions
async function handleMessages(message: { target: string; type: any; data?: any; }): Promise<void> {
    if (message.target !== 'background') return;

    switch (message.type) {
        case 'play-sound':
            await handlePlaySound();
            break;
        case 'show-notification':
            sendNotification();
            break;
        case 'clear-badge':
            await clearBadge();
            break;
    }
}

function handleNotificationClick(notificationId: string): void {
    openProlificTab();
    
    chrome.notifications.clear(notificationId);
}

function handleNotificationButtonClick(notificationId: string, buttonIndex: number): void {
    if (buttonIndex === 0) {
        openProlificTab();
    }
    
    chrome.notifications.clear(notificationId);
}

async function handleInstallation(details: { reason: string; }): Promise<void> {
    if (details.reason === "install") {
        await setInitialValues();
        setTimeout(() => openWelcomePage(), 1000);
    }
}

async function openProlificOnStartup(): Promise<void> {
    if (await getValueFromStorage(CONFIG.OPEN_PROLIFIC, false)) {
        await chrome.tabs.create({ url: CONFIG.PROLIFIC_URL, active: false });
    }
}

async function handleTabUpdate(_: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): Promise<void> {
    previousTitle = await getValueFromStorage(CONFIG.PROLIFIC_TITLE, 'Prolific');
    
    if (tab.url?.includes(CONFIG.PROLIFIC_URL) && changeInfo.title && changeInfo.title !== previousTitle && tab.status === 'complete') {
        await handleTitleChange(changeInfo.title);
    }
}

// Utility functions
function getValueFromStorage<T>(key: string, defaultValue: T): Promise<T> {
    return new Promise((resolve) => {
        chrome.storage.sync.get(key, (result) => {
            resolve(result[key] !== undefined ? result[key] as T : defaultValue);
        });
    });
}

function getNumberFromTitle(title: string): number {
    const match = title.match(/\((\d+)\)/);
    return match ? parseInt(match[1]) : 0;
}

async function handlePlaySound(): Promise<void> {
    audio = await getValueFromStorage(CONFIG.AUDIO, 'alert1.mp3');
    volume = (await getValueFromStorage(CONFIG.VOLUME, 100)) / 100;
    await playAudio(audio, volume);
    sendNotification();
}

async function handleTitleChange(newTitle: string): Promise<void> {
    const previousNumber = getNumberFromTitle(previousTitle);
    const currentNumber = getNumberFromTitle(newTitle);

    await chrome.storage.sync.set({ [CONFIG.PROLIFIC_TITLE]: newTitle });

    if (newTitle.trim() !== 'Prolific' && currentNumber > previousNumber) {
        shouldSendNotification = await getValueFromStorage(CONFIG.SHOW_NOTIFICATION, true);
        if (shouldSendNotification) {
            sendNotification();
        }

        shouldPlayAudio = await getValueFromStorage(CONFIG.AUDIO_ACTIVE, true);
        if (shouldPlayAudio) {
            audio = await getValueFromStorage(CONFIG.AUDIO, 'alert1.mp3');
            volume = (await getValueFromStorage(CONFIG.VOLUME, 100)) / 100;
            await playAudio(audio, volume);
        }

        await updateCounterAndBadge(currentNumber - previousNumber);
    }
}

async function setInitialValues(): Promise<void> {
    const initialValues = {
        [CONFIG.AUDIO_ACTIVE]: true,
        [CONFIG.AUDIO]: "alert1.mp3",
        [CONFIG.SHOW_NOTIFICATION]: true,
        [CONFIG.VOLUME]: 100
    };

    await chrome.storage.sync.set(initialValues);
}

function sendNotification(): void {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL(CONFIG.ICON_URL),
        title: CONFIG.TITLE,
        message: CONFIG.MESSAGE,
        buttons: [{ title: 'Open Prolific' }, { title: 'Dismiss' }]
    });
}

async function updateBadge(counter: number): Promise<void> {
    await chrome.action.setBadgeText({ text: counter.toString() });
    await chrome.action.setBadgeBackgroundColor({ color: "#9dec14" });

    setTimeout(async () => {
        await chrome.action.setBadgeText({ text: '' });
    }, 20000);
}

async function updateCounterAndBadge(count: number): Promise<void> {
    let counter = await getValueFromStorage(CONFIG.COUNTER, 0) + count;
    await chrome.storage.sync.set({ [CONFIG.COUNTER]: counter });
    await updateBadge(count);
}

async function playAudio(audio: string = 'alert1.mp3', volume: number = 1.0): Promise<void> {
    await setupOffscreenDocument('audio/audio.html');
    const req = { audio, volume };
    await chrome.runtime.sendMessage({ type: 'play-sound', target: 'offscreen-doc', data: req });
}

async function setupOffscreenDocument(path: string): Promise<void> {
    // Check all windows controlled by the service worker to see if one
    // of them is the offscreen document with the given path
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) return;

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: [Reason.AUDIO_PLAYBACK],
            justification: 'Audio playback'
        });
        
        await creating;
        creating = null;
    }
}

// Helper functions
function openProlificTab(): void {
    chrome.tabs.create({ url: CONFIG.PROLIFIC_URL, active: true });
}

function openWelcomePage(): void {
    chrome.tabs.create({ url: CONFIG.WELCOME_URL, active: true });
}

async function clearBadge(): Promise<void> {
    await chrome.action.setBadgeText({ text: '' });
}