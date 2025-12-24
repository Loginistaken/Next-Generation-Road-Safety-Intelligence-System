# ===================================================
# RSIS 4.0 - Upgraded All-in-One Ruby Prototype
# ===================================================
# Upgrades implemented:
# - Persistent actors (one per user, updated in place)
# - Added heading (direction in degrees) to Actor
# - Proper TTC calculation using velocity vectors
# - Dynamic/adaptive tile sizes (smaller in urban areas)
# - Realistic trust score adjustment based on update consistency
# - In-memory "database" simulation with persistence across updates
# - Simulated WebSocket/ActionCable broadcast to all relevant tiles
# - More realistic BLE placeholder with mock scanning
# - Kept all prior code structure and logic intact where possible
# ===================================================

require 'bcrypt'
require 'jwt'
require 'securerandom'
require 'geocoder'
require 'json'
require 'set'

# ------------------------------
# Models
# ------------------------------

class User
  attr_accessor :username, :password_digest, :role, :agreement_accepted, :actor
  ROLES = %i[walker cyclist vehicle passenger]

  def initialize(username:, password:, role:, agreement_accepted:)
    @username = username
    @password_digest = BCrypt::Password.create(password)
    @role = role
    @agreement_accepted = agreement_accepted
    @actor = nil  # Will hold the persistent Actor instance
  end

  def authenticate(password)
    BCrypt::Password.new(@password_digest) == password
  end
end

class Actor
  attr_accessor :user, :lat, :lon, :speed, :heading, :ephemeral_token, :trust_score
  attr_accessor :hazard_tile, :last_update_time, :prev_lat, :prev_lon

  def initialize(user:, lat:, lon:, speed:, heading: 0.0, hazard_tile:)
    @user = user
    @lat = lat
    @lon = lon
    @speed = speed
    @heading = heading  # degrees, 0 = North, 90 = East
    @hazard_tile = hazard_tile
    @trust_score = 1.0
    @last_update_time = Time.now
    @prev_lat = lat
    @prev_lon = lon
    rotate_token
  end

  def update_position(lat:, lon:, speed:, heading:)
    @prev_lat = @lat
    @prev_lon = @lon
    @lat = lat
    @lon = lon
    @speed = speed
    @heading = heading
    @last_update_time = Time.now
    rotate_token
  end

  def rotate_token
    @ephemeral_token = SecureRandom.hex(8)  # Longer for realism
  end

  # Adjust trust based on update plausibility (speed, distance traveled)
  def adjust_trust(new_lat, new_lon, new_speed)
    return if @prev_lat.nil?

    distance = Geocoder::Calculations.distance_between([@prev_lat, @prev_lon], [new_lat, new_lon], units: :km) * 1000 # meters
    time_delta = Time.now - @last_update_time
    expected_max_distance = (new_speed + @speed) / 2 * time_delta / 3.6 # avg speed in m/s

    if distance > expected_max_distance * 2.0  # Implausible jump
      @trust_score -= 0.2
    elsif distance > expected_max_distance * 1.2
      @trust_score -= 0.05
    else
      @trust_score += 0.01 if @trust_score < 1.0
    end

    @trust_score = [[@trust_score, 0.3].max, 1.0].min
  end
end

class HazardTile
  attr_accessor :tile_id, :actors, :risk_score, :risk_history, :center_lat, :center_lon, :size_degrees

  def initialize(tile_id, center_lat, center_lon, size_degrees)
    @tile_id = tile_id
    @actors = Set.new
    @risk_score = 0
    @risk_history = []
    @center_lat = center_lat
    @center_lon = center_lon
    @size_degrees = size_degrees
  end

  def add_risk_score(score)
    @risk_history << score
    @risk_history.shift if @risk_history.size > 100
    @risk_score = score
  end

  def contains?(lat, lon)
    half = @size_degrees / 2.0
    lat >= @center_lat - half && lat < @center_lat + half &&
      lon >= @center_lon - half && lon < @center_lon + half
  end
end

# ------------------------------
# JWT Service
# ------------------------------

class JwtService
  SECRET_KEY = 'RSIS_SECRET_KEY_V4'

  def self.encode(payload, exp=Time.now.to_i + 24*3600)
    payload[:exp] = exp
    JWT.encode(payload, SECRET_KEY)
  end

  def self.decode(token)
    JWT.decode(token, SECRET_KEY)[0]
  rescue
    nil
  end
end

# ------------------------------
# Hazard Tile Service (Dynamic Tile Sizes)
# ------------------------------

class HazardTileService
  @@tiles = {}
  @@base_tile_size = 0.0005  # ~55m at equator (much smaller than before)

  # Adaptive tile size: smaller in dense/urban areas (simulated by lat/lon density)
  def self.determine_tile_size(lat, lon)
    # Simulate urban density: smaller tiles near city centers
    if [37.77, -122.41, 40.71, -74.00, 51.50, -0.12].any? do |clat, clon|
         Geocoder::Calculations.distance_between([lat, lon], [clat, clon]) < 20 # km
       end
      0.0003  # ~33m in urban
    else
      @@base_tile_size
    end
  end

  def self.locate(lat, lon)
    size = determine_tile_size(lat, lon)
    tile_lat = (lat / size).floor * size + size / 2.0
    tile_lon = (lon / size).floor * size + size / 2.0
    tile_id = "#{tile_lat}_#{tile_lon}_#{size}"

    @@tiles[tile_id] ||= HazardTile.new(tile_id, tile_lat, tile_lon, size)
    @@tiles[tile_id]
  end

  def self.find_tile_for_actor(lat, lon)
    @@tiles.values.find { |tile| tile.contains?(lat, lon) } || locate(lat, lon)
  end

  def self.all_tiles
    @@tiles
  end
end

# ------------------------------
# Actor Service (Persistent Actors)
# ------------------------------

class ActorService
  def self.update_or_create(user, lat:, lon:, speed:, heading: 0.0)
    tile = HazardTileService.locate(lat, lon)

    if user.actor && user.actor.hazard_tile == tile
      # Update existing actor
      old_tile = user.actor.hazard_tile
      old_tile.actors.delete(user.actor) if old_tile != tile

      user.actor.adjust_trust(lat, lon, speed)
      user.actor.update_position(lat: lat, lon: lon, speed: speed, heading: heading)
      user.actor.hazard_tile = tile
    else
      # Remove from old tile if exists
      user.actor.hazard_tile.actors.delete(user.actor) if user.actor

      # Create new or reassign
      actor = Actor.new(user: user, lat: lat, lon: lon, speed: speed, heading: heading, hazard_tile: tile)
      user.actor = actor
    end

    tile.actors.add(user.actor)

    RiskService.evaluate(tile)
    BleService.broadcast_ephemeral(user.actor.ephemeral_token)
    WebsocketService.broadcast_tile(tile)

    user.actor
  end
end

# ------------------------------
# Risk Service (Vector-based TTC)
# ------------------------------

class RiskService
  ROLE_PRIORITY = { walker: 4, cyclist: 3, vehicle: 1, passenger: 2 }  # Increased walker priority
  TTC_THRESHOLD = 6.0

  def self.evaluate(tile)
    return if tile.actors.size < 2

    max_risk = 0
    actors = tile.actors.to_a

    actors.combination(2).each do |a, b|
      ttc = TTCService.calculate(a, b)
      next if ttc > TTC_THRESHOLD || ttc == Float::INFINITY

      # Risk weighted by trust and role
      risk = (ROLE_PRIORITY[a.user.role.to_sym] * a.trust_score +
              ROLE_PRIORITY[b.user.role.to_sym] * b.trust_score)

      max_risk = [risk, max_risk].max
    end

    tile.add_risk_score(max_risk.round(1))
  end
end

# ------------------------------
# TTC Service (Proper vector-based calculation)
# ------------------------------

class TTCService
  def self.to_radians(deg)
    deg * Math::PI / 180.0
  end

  def self.calculate(a, b)
    # Convert speed and heading to velocity vectors (m/s)
    va_x = a.speed * Math.sin(to_radians(a.heading)) * 1000 / 3600
    va_y = a.speed * Math.cos(to_radians(a.heading)) * 1000 / 3600
    vb_x = b.speed * Math.sin(to_radians(b.heading)) * 1000 / 3600
    vb_y = b.speed * Math.cos(to_radians(b.heading)) * 1000 / 3600

    # Relative velocity
    vr_x = va_x - vb_x
    vr_y = va_y - vb_y
    relative_speed = Math.sqrt(vr_x**2 + vr_y**2)

    return Float::INFINITY if relative_speed < 0.1  # Almost stationary or parallel

    # Position difference (approx in meters using simple conversion)
    dx_m = (a.lon - b.lon) * 111320 * Math.cos(to_radians((a.lat + b.lat)/2))
    dy_m = (a.lat - b.lat) * 110540

    # Time to collision
    if vr_x * dx_m + vr_y * dy_m >= 0
      Float::INFINITY  # Moving away
    else
      -(vr_x * dx_m + vr_y * dy_m) / (vr_x**2 + vr_y**2)
    end
  end
end

# ------------------------------
# BLE Service (Improved Placeholder)
# ------------------------------

class BleService
  @@scanned_tokens = Set.new

  def self.broadcast_ephemeral(token)
    puts "[BLE] Broadcasting ephemeral token: #{token}"
    @@scanned_tokens.add(token)
  end

  def self.simulate_nearby_scan
    puts "[BLE] Scanning... detected #{@@scanned_tokens.size} nearby devices"
    @@scanned_tokens.each { |t| puts "   → #{t}" }
  end
end

# ------------------------------
# WebSocket / ActionCable Simulation
# ------------------------------

class WebsocketService
  def self.broadcast_tile(tile)
    payload = {
      tile_id: tile.tile_id,
      risk_score: tile.risk_score,
      actor_count: tile.actors.size,
      actors: tile.actors.map { |a|
        {
          role: a.user.role,
          lat: a.lat.round(6),
          lon: a.lon.round(6),
          speed: a.speed,
          heading: a.heading,
          trust: a.trust_score.round(2),
          token: a.ephemeral_token
        }
      }
    }
    puts "[ActionCable] Broadcasting to clients → Tile #{tile.tile_id} | Risk: #{tile.risk_score} | Actors: #{tile.actors.size}"
    puts "   Payload: #{JSON.generate(payload)[0..200]}..."
  end
end

# ------------------------------
# Controller / App Logic
# ------------------------------

class RSISApp
  def initialize
    @users = {}
  end

  def signup(username:, password:, role:, agreement_accepted:)
    raise 'Agreement must be accepted' unless agreement_accepted
    raise 'Invalid role' unless User::ROLES.include?(role.to_sym)
    user = User.new(username: username, password: password, role: role, agreement_accepted: agreement_accepted)
    @users[username] = user
    token = JwtService.encode(user_id: username, role: role)
    { token: token }
  end

  def login(username:, password:)
    user = @users[username]
    raise 'User not found' unless user
    raise 'Invalid password' unless user.authenticate(password)
    token = JwtService.encode(user_id: username, role: user.role)
    { token: token }
  end

  def update_actor(token:, lat:, lon:, speed:, heading: 0.0)
    payload = JwtService.decode(token)
    raise 'Unauthorized' unless payload
    user = @users[payload['user_id']]
    raise 'User not found' unless user

    actor = ActorService.update_or_create(user, lat: lat, lon: lon, speed: speed, heading: heading)

    {
      tile_id: actor.hazard_tile.tile_id,
      risk_score: actor.hazard_tile.risk_score,
      ephemeral_token: actor.ephemeral_token,
      trust_score: actor.trust_score.round(2),
      message: "Actor updated (persistent)"
    }
  end

  def predict_ttc(tile_id)
    tile = HazardTileService.all_tiles[tile_id]
    return Float::INFINITY unless tile && tile.actors.size >= 2

    min_ttc = Float::INFINITY
    tile.actors.to_a.combination(2) do |a, b|
      ttc = TTCService.calculate(a, b)
      min_ttc = [min_ttc, ttc].min if ttc.finite?
    end
    min_ttc.round(2)
  end

  def all_hazard_tiles
    HazardTileService.all_tiles.map do |id, tile|
      {
        tile_id: id,
        center: [tile.center_lat, tile.center_lon],
        size_degrees: tile.size_degrees,
        risk_score: tile.risk_score,
        actor_count: tile.actors.size,
        actors: tile.actors.map { |a|
          {
            username: a.user.username,
            role: a.user.role,
            lat: a.lat,
            lon: a.lon,
            speed: a.speed,
            heading: a.heading,
            trust: a.trust_score.round(2),
            token: a.ephemeral_token
          }
        }
      }
    end
  end

  def simulate_ble_scan
    BleService.simulate_nearby_scan
  end
end

# ------------------------------
# Example Usage / Simulation
# ------------------------------

app = RSISApp.new

# Sign-up
alice = app.signup(username: 'alice', password: 'pass123', role: 'walker', agreement_accepted: true)
bob   = app.signup(username: 'bob', password: 'pass456', role: 'vehicle', agreement_accepted: true)

puts "\n=== Initial Updates ==="
app.update_actor(token: alice[:token], lat: 37.7749, lon: -122.4194, speed: 1.4, heading: 90)   # Walking east
app.update_actor(token: bob[:token],   lat: 37.7749, lon: -122.4180, speed: 12.0, heading: 270) # Driving west (towards alice)

puts "\n=== Moving Closer ==="
app.update_actor(token: alice[:token], lat: 37.7749, lon: -122.4190, speed: 1.3, heading: 90)
app.update_actor(token: bob[:token],   lat: 37.7749, lon: -122.4185, speed: 11.0, heading: 270)

puts "\n=== Critical Proximity ==="
app.update_actor(token: alice[:token], lat: 37.7749, lon: -122.4188, speed: 1.2, heading: 90)
app.update_actor(token: bob[:token],   lat: 37.7749, lon: -122.4189, speed: 10.0, heading: 270)

puts "\n=== BLE Simulation ==="
app.simulate_ble_scan

puts "\n=== Final State ==="
puts JSON.pretty_generate(app.all_hazard_tiles)
