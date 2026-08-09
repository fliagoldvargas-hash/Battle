let notificationHandler = null

export function notify(type, title, message) {
  notificationHandler?.({ type, title, message })
}

export function setNotificationHandler(handler) {
  notificationHandler = handler
}
