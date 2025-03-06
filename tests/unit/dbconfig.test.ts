import { connectDb, disconnectDB } from "../../src/utils/dbconfig";

// Mock mongoose
jest.mock("mongoose", () => {
  return {
    connect: jest.fn().mockResolvedValue(true),
    connection: {
      close: jest.fn().mockResolvedValue(true),
    },
  };
});

describe("Database Configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("connectDb", () => {
    it("should return null in test environment", async () => {
      // Set NODE_ENV to test
      process.env.NODE_ENV = "test";

      const result = await connectDb("mongodb://localhost:27017/test");

      expect(result).toBeNull();

      // Verify mongoose.connect was not called
      const mongoose = require("mongoose");
      expect(mongoose.connect).not.toHaveBeenCalled();
    });

    it("should connect to database in non-test environment", async () => {
      // Set NODE_ENV to development
      process.env.NODE_ENV = "development";

      const dbUrl = "mongodb://localhost:27017/test";
      await connectDb(dbUrl);

      // Verify mongoose.connect was called with correct parameters
      const mongoose = require("mongoose");
      expect(mongoose.connect).toHaveBeenCalledWith(dbUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
    });
  });

  describe("disconnectDB", () => {
    it("should close the database connection", async () => {
      await disconnectDB();

      // Verify mongoose.connection.close was called
      const mongoose = require("mongoose");
      expect(mongoose.connection.close).toHaveBeenCalled();
    });

    it("should handle errors when closing connection", async () => {
      // Mock console.log and process.exit
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
      const processExitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as any);

      // Mock mongoose.connection.close to throw error
      const mongoose = require("mongoose");
      mongoose.connection.close.mockRejectedValue(
        new Error("Connection error")
      );

      await disconnectDB();

      // Verify error was logged and process.exit was called
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);

      // Restore mocks
      consoleLogSpy.mockRestore();
      processExitSpy.mockRestore();
    });
  });
});
