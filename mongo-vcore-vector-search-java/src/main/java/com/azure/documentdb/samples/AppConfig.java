package com.azure.documentdb.samples;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

/**
 * Application configuration loaded from environment variables and application.properties file.
 */
public class AppConfig {
    private final Map<String, String> config = new HashMap<>();
    
    public AppConfig() {
        loadFromEnvironment();
        loadFromPropertiesFile();
    }
    
    private void loadFromEnvironment() {
        System.getenv().forEach(config::put);
    }
    
    private void loadFromPropertiesFile() {
        try (InputStream input = getClass().getClassLoader().getResourceAsStream("application.properties")) {
            if (input != null) {
                Properties properties = new Properties();
                properties.load(input);
                properties.forEach((key, value) -> config.putIfAbsent(key.toString(), value.toString()));
            }
        } catch (IOException e) {
            System.err.println("Warning: Could not read application.properties file: " + e.getMessage());
        }
    }
    
    public String get(String key) {
        return config.get(key);
    }
    
    public String getOrDefault(String key, String defaultValue) {
        return config.getOrDefault(key, defaultValue);
    }
    
    public int getIntOrDefault(String key, int defaultValue) {
        var value = config.get(key);
        return value != null ? Integer.parseInt(value) : defaultValue;
    }
}
