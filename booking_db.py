import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).with_name('bookings.db')


def init_db(db_path: Path = DB_PATH) -> None:
    """Create bookings table if it does not exist."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                passenger_name TEXT NOT NULL,
                passenger_id TEXT NOT NULL,
                seat_preference TEXT,
                origin_station TEXT NOT NULL,
                destination_station TEXT NOT NULL,
                travel_date TEXT NOT NULL,
                train_code TEXT,
                departure_time TEXT,
                price_sar REAL,
                created_at TEXT NOT NULL
            )
            '''
        )
        conn.commit()


def save_booking(
    passenger_name: str,
    passenger_id: str,
    seat_preference: str,
    origin_station: str,
    destination_station: str,
    travel_date: str,
    train_code: str,
    departure_time: str,
    price_sar: float,
    db_path: Path = DB_PATH,
) -> int:
    """Insert a booking row and return inserted booking id."""
    init_db(db_path)
    created_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            '''
            INSERT INTO bookings (
                passenger_name,
                passenger_id,
                seat_preference,
                origin_station,
                destination_station,
                travel_date,
                train_code,
                departure_time,
                price_sar,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                passenger_name,
                passenger_id,
                seat_preference,
                origin_station,
                destination_station,
                travel_date,
                train_code,
                departure_time,
                price_sar,
                created_at,
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def list_bookings(db_path: Path = DB_PATH) -> list[tuple]:
    """Return all bookings sorted by newest first."""
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            '''
            SELECT
                id,
                passenger_name,
                passenger_id,
                seat_preference,
                origin_station,
                destination_station,
                travel_date,
                train_code,
                departure_time,
                price_sar,
                created_at
            FROM bookings
            ORDER BY id DESC
            '''
        ).fetchall()
    return rows


def _interactive_add() -> None:
    print('Enter booking details:')
    passenger_name = input('Passenger name: ').strip()
    passenger_id = input('Passenger ID/Passport: ').strip()
    seat_preference = input('Seat preference (Window/Aisle): ').strip() or 'Any'
    origin_station = input('From station: ').strip() or 'Riyadh'
    destination_station = input('To station: ').strip() or 'Diriyah'
    travel_date = input('Travel date (YYYY-MM-DD): ').strip()
    train_code = input('Train code (e.g. DX101): ').strip() or 'DX101'
    departure_time = input('Departure time (e.g. 04:30 PM): ').strip() or '04:30 PM'

    price_raw = input('Price SAR (e.g. 50): ').strip() or '50'
    try:
        price_sar = float(price_raw)
    except ValueError as exc:
        raise ValueError('Price must be a number.') from exc

    if not passenger_name or not passenger_id or not travel_date:
        raise ValueError('Passenger name, passenger id, and travel date are required.')

    booking_id = save_booking(
        passenger_name=passenger_name,
        passenger_id=passenger_id,
        seat_preference=seat_preference,
        origin_station=origin_station,
        destination_station=destination_station,
        travel_date=travel_date,
        train_code=train_code,
        departure_time=departure_time,
        price_sar=price_sar,
    )
    print(f'Booking saved successfully. Booking ID: {booking_id}')
    print(f'Database file: {DB_PATH}')


def _print_bookings() -> None:
    rows = list_bookings()
    if not rows:
        print('No bookings found yet.')
        return

    print('Bookings:')
    for row in rows:
        (
            booking_id,
            name,
            pid,
            seat,
            origin,
            destination,
            travel_date,
            train_code,
            departure_time,
            price,
            created_at,
        ) = row
        print(
            f'#{booking_id} | {name} ({pid}) | {origin}->{destination} | '
            f'{travel_date} {departure_time} | {train_code} | {seat} | {price} SAR | {created_at}'
        )


def main() -> None:
    parser = argparse.ArgumentParser(description='Manage train bookings in SQLite.')
    parser.add_argument('--list', action='store_true', help='List all saved bookings.')
    args = parser.parse_args()

    if args.list:
        _print_bookings()
        return

    _interactive_add()


if __name__ == '__main__':
    main()
