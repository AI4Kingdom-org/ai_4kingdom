export const schema = {
  version: 1,
  models: {
    ChatHistory: {
      name: "ChatHistory",
      fields: {
        UserId: { type: "String", required: true },
        Timestamp: { type: "String", required: true },
        Message: { type: "String", required: true }
      },
      primaryIndex: { partitionKey: "UserId", sortKey: "Timestamp" }
    }
  }
}; 