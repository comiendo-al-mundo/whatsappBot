"use strict";

const express = require("express");
const api = express.Router();

// Initialize the controller
const whatsappController = require("./whatsappController");

// Send a message
api.post("/sendMessage", whatsappController.sendMessage);

// Reload
api.post("/reloadPhone", whatsappController.reloadPhone);

module.exports = api;