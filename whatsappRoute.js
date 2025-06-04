"use strict";

const express = require("express");
const api = express.Router();

// Initialize the controller
const whatsappController = require("./whatsappController");

// Send a message
api.post("/sendMessage", whatsappController.sendMessage);

module.exports = api;