let processing = false;
let pressed = false;
let processed = false;
var notification = "my-notification";

var error = false;

var TabId;

if (typeof browser == "undefined")
  var browser = chrome;

var _supportsPromises = false;
try {
  _supportsPromises = browser.runtime.getPlatformInfo() instanceof Promise;
}
catch (e)
{
}

//This listener starts to work when the user press the extension's button
browser.action.onClicked.addListener((tab) => {
  
  var description;
  TabId = tab.id;
  
  description = browser.i18n.getMessage("extractingMessage");
  browser.action.setBadgeText({text: "Ex", tabId: TabId});
  browser.action.setTitle({title: description, tabId: TabId});
  var bgp =  browser.tabs.getCurrent();
  messagePassing();
  browser.action.disable(tab.id);
});

function treatMessage(message) {

  if(message.content == "message") {
    var header = browser.i18n.getMessage("messageTitle");
    var content1 = browser.i18n.getMessage("bodyMessage");
  
    browser.notifications.create(notification, {
      "type": "basic",
      "iconUrl": browser.runtime.getURL("icons/c2.png"),
      "title": header,
      "message": content1
    });  
  }
  else if(message.content == "endExtraction") {
    endExtraction();
  }
  else if(message.content == "error") {
    error = true;
	browser.notifications.clear(notification);
    endExtraction();
  }
}

browser.runtime.onMessage.addListener(treatMessage);

function messagePassing() {
 //browser.tabs.query({currentWindow: true, active: true}).then(sendMessageToTabs).catch(onError);
  var queryInfo = {
    active: true,
    currentWindow: true
  };

  chrome.tabs.query(queryInfo, function(tabs) {
  // for (let tab of tabs) {
    browser.tabs.sendMessage(
      tabs[0].id,
      {greeting: ""}
    )
  //}
  })
  }

function sendMessageToTabs(tabs) {
    browser.tabs.sendMessage(
      tabs[0].id,
      {greeting: ""}
    ).catch(onError);
}

function onError(error) {

  console.log("Error: "+ error);

  var header = browser.i18n.getMessage("errorTitle");
  var content1 = browser.i18n.getMessage("errorMessage");
  var description = browser.i18n.getMessage("errorMessage");
  
    browser.notifications.create(notification, {
      "type": "basic",
      "iconUrl": browser.runtime.getURL("icons/c2.png"),
      "title": header,
      "message": content1
    }); 

    browser.action.setBadgeText({text: "Error", tabId: TabId});
    browser.action.setTitle({title: description, tabId: TabId});
}


function endExtraction() {

  browser.action.enable(TabId);

  if(error) {
    browser.action.setIcon({path: "/icons/c3.png", tabId: TabId});
    browser.action.setBadgeText({text: "Error", tabId: TabId});
    browser.tabs.reload();
  }
  else {   
    if(!pressed){
      browser.action.setBadgeText({text: "End", tabId: TabId});
      browser.action.setIcon({path: "/icons/con-right.png", tabId: TabId});
      description = browser.i18n.getMessage("backToWeb");
      pressed = true;
    }
    else {
      browser.action.setBadgeText({text: "", tabId: TabId});
      browser.action.setIcon({path: "/icons/con-left.png", tabId: TabId});
      description = browser.i18n.getMessage("backToContent");
      pressed = false;
    }
  }

  error = false;
}

function updated(tab) {
	if(tab == TabId) {
		pressed = false;
		browser.action.setIcon({path: "/icons/c3.png", tabId: TabId});
		description = browser.i18n.getMessage("extensionDescription");
		browser.action.setTitle({title: description, tabId: TabId});
		browser.action.setBadgeText({text: "", tabId: TabId});
	}
}

browser.tabs.onUpdated.addListener(updated);

