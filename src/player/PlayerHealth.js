const MAX_HEALTH = 100;
const REGEN_DELAY = 3.5;
const REGEN_RATE = 28;
const LOW_HEALTH_THRESHOLD = 30;

export class PlayerHealth {
  constructor() {
    this.health = MAX_HEALTH;
    this.maxHealth = MAX_HEALTH;
    this.alive = true;
    this.regenTimer = 0;
    this.recentDamage = 0;
    this.lowHealth = false;

    this.onDeath = null;
    this.onDamage = null;
    this.onRegen = null;
    this.onLowHealth = null;
  }

  takeDamage(amount, direction) {
    if (!this.alive) return;

    this.health -= amount;
    this.regenTimer = 0;
    this.recentDamage = amount;

    if (this.onDamage) {
      this.onDamage(amount, direction || null);
    }

    if (this.health <= LOW_HEALTH_THRESHOLD && !this.lowHealth) {
      this.lowHealth = true;
      if (this.onLowHealth) {
        this.onLowHealth();
      }
    }

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (this.onDeath) {
        this.onDeath();
      }
    }
  }

  update(dt) {
    if (!this.alive) return;

    if (this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= REGEN_DELAY) {
        const wasBelow = this.health;
        this.health = Math.min(this.maxHealth, this.health + REGEN_RATE * dt);
        if (this.onRegen && wasBelow < this.maxHealth) {
          this.onRegen(this.health);
        }
        if (this.health > LOW_HEALTH_THRESHOLD && this.lowHealth) {
          this.lowHealth = false;
        }
      }
    }
  }

  getHealth() {
    return this.health;
  }

  getMaxHealth() {
    return this.maxHealth;
  }

  isAlive() {
    return this.alive;
  }

  isLowHealth() {
    return this.lowHealth;
  }

  reset() {
    this.health = MAX_HEALTH;
    this.alive = true;
    this.regenTimer = 0;
    this.recentDamage = 0;
    this.lowHealth = false;
  }
}
